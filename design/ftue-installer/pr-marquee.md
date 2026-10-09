The owner, 2026-10-08: "the drag selection box is a solid blue square, is this normal for blender? I don't think so".

**Cause.** `editor-viewport.ts` painted the box with `themeVars.accent.default` (border) and `accent.muted` (fill). The Blender look maps both to `tui.wcol_regular.inner_sel`, an opaque blue rgb(71,114,179), so the fill was solid.

**Blender's real box**, from volter-ai/blender 7d924389 (5.2.0), `wm_gesture.cc` `wm_gesture_draw_rect`, lines 214-252:
- fill white at 5% (`immUniformColor4f(1,1,1,0.05)`, alpha-blended);
- a 1 UI px dashed outline, using the dashed shader with `color` 0.4 grey and `color2` white, `dash_width` 8 and `udash_factor` 0.5. That's 4 device px of #666666, then 4 of #ffffff.

**Fix: the box is the look's** (ARCHITECTURE rule 7).
- **New tokens:** `color.viewport.marqueeLine`, `marqueeFill`, `marqueeGap` and `stage.marqueeDash`.
- **Blender look:** `#666666`, `rgba(255,255,255,0.05)`, `#ffffff`, dash `4`. They're entered in `blender-palette.source.mjs` with the citations, and the JSON was regenerated with its script (`--check` passes; only the 3 new keys changed).
- **Every other look** defaults to its accent pair and a solid line, exactly as before, and palettes saved before the tokens existed fall back the same way (`theme-library.ts`).
- **Drawing:** the viewport draws a dashed outline as four 1 px gradient strips over a transparent 1 px border, so the box sits exactly where the solid one did.

**Verified:**
- **Typecheck:** editor-project, editor-sdk and editor-threejs have 0 errors. editor-blender's errors are only in untouched files, from cross-checkout blender-engine types.
- **Bug reproduced:** in published 0.5.197 (playable project, Blender look), a held `editor.document.drag` showed the solid blue box (`01-…png`).
- **Branch paint, previewed in that live editor:** I set the branch's three Blender token values on the live box and applied a copy of the new painting function. Edge pixels alternate exactly 4 px (102,102,102) and 4 px (255,255,255), the inside is faintly lighter, and the selected car's outline shows through (`02-…png`, `03-…png` at 8×; in `marquee-check/` on volter-desktop).
- **Not verified:** the branch's own code path running in an editor, and other looks live.

No sign-in, no tests.

Left alone: the asset drag-and-drop overlay (`_showDropOverlay`) uses the same accent pair and is probably also an opaque sheet under the Blender look; that's a follow-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
