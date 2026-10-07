# Editor SDK

Extension, contribution and editor-session APIs for Volter Editor. This package
depends on the project contracts, not the editor implementation or game runtime.

The viewport presentation contract accepts a root identity and native mounted
adapter surface. It does not require a game's input system, loop or execution
API. Richer product-owned roots can satisfy that interface directly.

Account/generation projections, project-tool declarations and tab observations
used by this SDK live here, transferred from the former general SDK. They are
data contracts, not provider integrations. The rest of that old SDK is not
included by default. Editor appearance data types have one owner in the project
contract and are exposed through the SDK's contribution-facing entry points.

Capture scope is explicit. `captureEditorChrome({region: 'page'})` reconstructs
the editor page, including chat and panels, from its DOM and canvas surfaces.
`region: 'document'` limits that reconstruction to the active document, including
its visible overlays. `region: 'play'` captures the active document's visible
Play frame, including its React HUD, and refuses when no such frame is mounted.
These reconstruct the editor's rendered surfaces, rather than using CDP,
browser chrome or a desktop image.
`EditorClient.captureGame()` captures the running game stack, including its React
HUD when the game bridge supports the composite; callers must inspect `composite`
and report a canvas-only fallback. Model Play fits its frame to the project's
declared resolution; `captureEditorChrome({region: 'play'})` captures that frame
without the authoring navigation or readouts. `region: 'document'` includes the
surrounding document as well. `captureActiveDocument()` captures the viewport drawing without its
navigation/readouts or DOM HUD. It can still contain in-scene references and
notes; it is not a final Blender render. Use an actual `bpy.ops.render.render()`
when verifying Blender output visibility.
A raw canvas recording excludes DOM UI.
Use editor captures to inspect authoring and game captures to judge the game;
measure capture cost separately from gameplay observed without capture.

Run `npm run typecheck -w @volter/editor-sdk` through the active World. This
package is private during migration. Existing session wire names remain intact
until their host and Code-OSS consumers move together; package renaming alone
does not complete product branding or consumer cutover.
