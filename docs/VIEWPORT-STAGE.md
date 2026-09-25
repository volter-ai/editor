# The viewport stage and its targets

Rule 6 of [ARCHITECTURE.md](../ARCHITECTURE.md) says a component is themable only when it can be themed into each of several real targets. For the 3D viewport the targets are Blender, Unity, Godot and Unreal. This page records what each target's default editor viewport is made of, with a source for every value, and what a look can declare today.

## The targets' default viewports

Measured from the engines' own sources, 2026-09-25. Colours are sRGB; a fourth value is alpha.

| Property | Blender 5 (`userdef_default_theme.c`, `space_view3d`) | Godot 4.4 (`editor_settings.cpp`, `node_3d_editor_plugin.cpp`, `editor_theme_manager.cpp`) | Unity 6 (UnityCsReference: `SceneView.cs`, `SceneViewGrid.cs`, `Handles.cs`) | Unreal 5 (read from its documentation's frames, not its source) |
|---|---|---|---|---|
| Backdrop | flat `#3d3d3d`; the theme also offers linear and radial gradients to `back_grad` `#303030` | procedural preview sky: top `(0.385, 0.454, 0.55)`, ground `(0.2, 0.169, 0.133)`, horizon derived from the two (their mix, pulled halfway to its own luminance x 3.333) | the scene's skybox (a new scene's procedural sky); flat `(0.278, 0.278, 0.278)` with the skybox off; `(0.132, 0.231, 0.330)` in Prefab Mode | the level's own sky (the Minimal Default level's sky atmosphere) |
| Light when the scene has none | none; Solid shading lights by studio light (a matcap-like preset), no scene light | preview sun: white, energy 1, altitude 60°, azimuth 150°, shadows to 100 m; sky energy 1 | a new scene's own Directional Light and the skybox's ambient | the level's own lights, in Lit mode |
| Tone and post | Solid mode draws unlit studio shading, no tone mapper | filmic tone mapper on, glow on, SSAO off, SDFGI off | none by default | not read from a frame |
| Grid | minor `#545454` at alpha 0.5, major `#545454`; axis lines at `grid_axis_brightness` 0.46 | primary `(0.56, 0.56, 0.56, 0.5)`, secondary `(0.38, 0.38, 0.38, 0.5)`, 8 primary steps; XY, XZ and YZ planes toggle separately | `(0.5, 0.5, 0.5, 0.4)` | none visible in the default frame |
| Axis colours | X `#ff3352`, Y `#8bdc00`, Z `#2890ff` | X `(0.96, 0.20, 0.32)`, Y `(0.53, 0.84, 0.01)`, Z `(0.16, 0.55, 0.96)` | X `(219, 62, 29)`, Y `(154, 243, 72)`, Z `(58, 122, 248)`, each alpha 0.93; centre `(0.8, 0.8, 0.8)` | an axis triad in the corner, Z up |
| Selection | selected `#ed5700`, active `#ffa028`, outline width 1 | selection BOX (the AABB's corners) `(1.0, 0.5, 0)`; no mesh outline | outline `#ff6600`; selected children `(94, 119, 155)`; wireframe selected `(94, 119, 155, 64)` | a thick yellow-orange outline |

Unreal is not installed on this box and its documentation does not state these defaults, so its column is read from the documentation's own frames (`/Volumes/PeakSSD/volter-work/engine-reference`, with the other engines' frames and their sources); its values are observations, not measured numbers.

## What a look can declare today

| Stage property | Declared by a look? | Where the value lives now |
|---|---|---|
| Backdrop colour | yes, one flat colour (`color.viewport.background`) | otherwise a gradient derived from the palette's panel colours and fixed stops `#1e2530` to `#4c5b70` (`standard-viewport-dressing.ts`); the game world's stage uses flat `0xaaaaaa` |
| Backdrop form (flat, gradient, radial, sky) | no | fixed: flat when the palette names a colour, gradient otherwise |
| Grid colour | yes, one colour (`color.viewport.grid`) | minor and major both derive from it; default `0x999999` |
| Grid alpha, major step, reach and fade, planes | no | fade from 55% to 100% of the grid radius, a grazing fade only when the palette names a backdrop (`editor-viewport.ts`, `standard-viewport-dressing.ts`) |
| Axis line colours and width | yes, named by the world's axes (`color.viewport.axisX`, `axisY`, optional `axisZ`, else the gizmo's; `stage.axisLineWidth`) | which lines show is the view's (`overlays.axes`) |
| Selection | colour and active colour (`color.viewport.selection`, `active`: a lone selected object outlines in the active colour); the outline's form, width and hidden parts (`outlineStyle`, `outlineWidth`, `outlineHidden`); the box's form, width and frame (`selectionBox`, `selectionBoxWidth`, `selectionBoxFrame`); the wire's colour and opacity (`color.viewport.wire`, `wireOpacity`) | no children colour; several selected objects do not yet tell the active one apart |
| Scene light when the scene has none | no | key `DirectionalLight(0xffffff, 1.9)` in the dressing; editor rig ambient 0.5 and directional 1.0 (`editor-viewport.ts`) |
| Environment and its strength | no | RoomEnvironment at a fixed strength (`StageHost.tsx`) |
| Tone mapping and exposure | no | ACES Filmic unless a document states its own |
| Gizmo size | yes (the material's `stage`) | |
| Gizmo colours, resting opacity, highlight | yes: `color.gizmo` (x, y, z; the navigation gizmo's own navigationX/Y/Z where the target draws it differently, as Blender's balls are; optional hover and drag) and `stage.gizmoOpacity`, `gizmoHighlightSaturation`, `gizmoHighlightValue` | the transform and navigation gizmos; without the group, the kit's own (Godot's axis colours, three's yellow highlight, opaque handles) |
| Move arrows' length and head, rotation rings' width | yes (`stage.gizmoArrowLength`, `gizmoArrowHead`, `gizmoRingWidth`) | |
| Navigation gizmo's form and corner | yes (`stage.navigationGizmo`: balls, cones, triad; `navigationCorner`) | whether it is clicked is the view's (`overlays.navigation`) |
| Other gizmo form (scale handles' shape, the plane handles' shape) | no | fixed: three's handles as patched |
| Armed tool, box-select test, up axis, the transform tool's extra handles, which axis lines show, the grid's switch (the person's grid toggle writes the active view's; there is no editor-wide one), whether the navigation gizmo is clicked | no: function, not look (ARCHITECTURE rule 7) | the stage's presentation (`interaction`, `world`, `overlays`) |

## Where a look's colours live

A look is its style: a palette (colours), a material (shape, density and the `stage` section above) and an icon set. Under the Code-OSS frame its colours are also the WORKBENCH's: the editor derives colour customizations from the look's resolved palette (`packages/editor-core/src/frame/look-colors.ts`) for the workbench's own chrome ids and for the stage's registered colours (`vgai.viewport.*`, `vgai.gizmo.*`). The frame applies them on the look's settings layer, under a person's own `workbench.colorCustomizations`. A look whose build ships a colour theme (Blender's `theme-blender`) keeps that theme's chrome and takes only the stage ids. The stage reads `--vscode-vgai-*` first and its own tokens where there is no workbench. Measured on a sources workbench: the Godot look wears its panel colour on the side bar, the stage's ids carry the palette's values, and a workspace override of `vgai.viewport.axisX` turned the X axis line green while the rest of the look stood.

## The ruling: look, presentation and starting values (owner, 2026-09-25)

The owner's question was how to handle backdrop and light, since they are "more functionality than look". The answer below was reviewed against the engines' sources before the owner approved it. Every target draws the same line: its theme holds colours, and light and environment are per-view settings a person toggles.

**1. The look holds colours only.** A style declares grid colours and alpha, the X, Y and Z axis colours, selection, active and hover colours and line widths, gizmo colours, overlay text, and the fill behind the scene, meaning its colour and its form (flat, linear or radial gradient). This is exactly Blender's theme (`space_view3d.back`, `back_grad`) and Unity's and Godot's colour preferences. A look holds no light, no sky and no switch.

**2. Presentation is four independent settings, one model for every 3D viewport.**
- *Draw mode*: the existing modes (solid, clay, unlit, wireframe, matcap, normals, overdraw).
- *Lighting*: a camera-locked studio preset (Blender's studio lights as data; Unity's headlight), a preview sun and environment (Godot's preview sun and sky; Blender's Material Preview HDRI, with colour, strength and rotation), or the scene's own lights. The source is `preview`, `scene` or `auto`; `auto` names what in the scene takes over (Godot: a DirectionalLight3D or a WorldEnvironment) and whether the person may override it. Blender and Unity never switch on their own.
- *Backdrop*: the look's fill, a per-view colour, the environment drawn behind the scene at an opacity and blur, the scene's own background, or transparent. The backdrop is separate from lighting: Blender's Material Preview lights by its HDRI and shows the fill behind (World Opacity defaults to 0), and Unity turns the skybox off without touching the light.
- *Overlays*: the grid (on or off, its step and planes) and selection shown as any set of outline, wire and box (Unity can show outline and wire together; Godot draws a box).

Presentation is saved per view and per draw mode, with an optional per-document override (Godot saves its preview per scene). `@volter/editor-threejs` owns it and applies it. It replaces three current homes: the Model document session's lighting, background and exposure (held in memory only), the kit's `three-viewport-presentation.ts`, and the game world stage's fixed fill. It is saved through the kit's view-state door.

**3. Starting values come from whoever builds the viewport.** The integration or product that builds a stage declares its starting presentation (the Blender integration: studio lighting on the look's fill). Starting values sit under the person's choices and never count toward which style is active. So a style switch never wipes a toggle, and a toggle never turns the style into a custom mix: `applyWorkspaceStyle` writes every axis of a bundle, and `activeWorkspaceStyleId` compares every axis.

**Where Blender's fitted values go.** The white key light and the environment strength become the Blender integration's default studio preset: Blender's own studio lights, up to four camera-locked lights with colour, specular and wrap plus an ambient (`release/datafiles/studiolights/studio/*.sl`, `SolidLight` in `DNA_userdef_types.h`). The material level fitted in engine `9134441` goes back to its source value and is measured again under those lights, because it was fitted to make up for a world-fixed key light that cannot reproduce Blender's studio light. Classic's look gets its own stage back, the blue-slate gradient.

**How acceptance is judged.** Rule 6, twice:
- the look passes when Blender, Godot and Unity looks, made only of values, each match frames of the real editor side by side;
- presentation passes when each target's default viewport and its toggles can be expressed without new code.

Neither is accepted until Unreal's column is measured.

## Where it stands (2026-09-25)

Built (`@volter/editor-sdk/kit/viewport-presentation`, `StagePresentationRig` in `standard-viewport-dressing.ts`):
- document stages (`StageHost`) and the game world's stage (`EditorViewport.bindPresentation`) are lit and dressed by their view's presentation;
- studio presets are data: the kit's own (the stage before the Blender fit), the reserved `document` preset (a document's own view-locked studio: Blender's four Solid-mode lights, which the Blender engine builds), and the world stage's (its old rig, unchanged);
- the preview source draws Godot's preview sun and procedural sky; the backdrop sources `color`, `environment` and `transparent` replace the stage's own;
- the stage's function: the tool it opens on, what a box drag selects and the world's up axis (`interaction`, `world`); the Blender integration starts its `model` stage on select, touch and Z-up, and a style switch leaves them alone;
- the gizmos' colours from the look, by source: Blender's theme axis colours at 0.6 resting opacity, highlighting in their own colour (`userdef_default_theme.c`, `transform_gizmo_3d.cc`); Godot's at 0.9, highlighting at a quarter saturation and full value (`theme_modern.cpp`, `node_3d_editor_plugin.cpp`); Unity's at 0.93 with its preselection and selected-axis colours (`Handles.cs`). The opacity is the handles'; the drag's axis lines keep three's own. Resting colours and opacity are checked on captures; the highlight is not yet seen on screen, as the product has no door that holds a hover;
- overlays: the selection marks (outline, wire, box, in any combination), the grid's major step and which world axis lines show; the look states the grid's line widths and major contrast, the axis lines' colours and width, and the box's form and frame (the material's `stage`);
- the transform tool's extra handles (scale, view-axis ring, free move) are the view's (`interaction.transformHandles`); the move arrows' length and head are the look's;
- the preview sky is a float strip with Godot's sun in it (disc and 30° glow on a 0.15 curve), so a sun brighter than white stays bright, and may carry a cloud layer (cover, opacity, scale) thinning into the horizon;
- environment images: a registered panorama (`@volter/editor-sdk/kit/environment-images`, contributed by `*.environment.ts`) in place of the sky, drawn and lit by, turned by the environment's rotation; `@volter/editor-blender` ships Blender's eight world studio lights (CC0). A preview may leave the scene's own lights out (`sceneLights`);
- a floor under a document's content (`overlays.floor`), at its lowest point, taking the preview sun's shadow, as Unreal's asset editors place their preview floor;
- `editor.presentation(documentId, layer?)` reads and records a view's presentation, and reports what its last draw was lit by.

Capability, per target (can its default viewport and its toggles be expressed without new code):

| Target | Expressible now | Not yet |
|---|---|---|
| Blender | Solid (its own studio, AgX, no environment), the fill, outline, grid step and widths; Material Preview (its world studio lights as environment images, Forest at strength 1 fixed in the world over the fill, the scene's lamps left out) | Rendered (the engine's render lighting is not a scene light the stage can switch to), box and wire on Blender documents (its selection ids are datablocks, not three objects) |
| Godot | preview sun and sky with the sun in it, sky as backdrop, 8-cell major step, the full box in the object's frame, all three axis lines, the Select gizmo's arrows and handles, its Filmic curve (the `filmic` mapper), ring width | per-part takeover (the sun and the environment give way separately; `auto` switches the whole source), the sun's energy unit, XY and YZ grid planes |
| Unity | its procedural sky and narrow horizon band (the sky's curves), the grid, a crisp outline around the whole silhouette, its wire colour, the Move tool without a free-move centre, the cone scene gizmo | the skybox toggle as a backdrop source over a scene without a skybox, Prefab Mode's context fill, per-mode lighting of draw modes, the scene gizmo's "Persp" label |
| Unreal | a sky standing in for the level's (preview), no grid, a crisp yellow-orange outline, the Move tool with its free-move centre, a Z-up LEFT-handed world, the bottom-left axis triad that is not clicked | its sky, cloud and floor values (the capabilities exist; the view does not state them yet), the plane handles' L shape and the centre sphere, the arrow shaft's thickness, the gizmo drawn dithered behind objects, an outline wider than about 3 px stays crisp |

Godot's default viewport is its style (`@volter/editor-game` `godot.style.ts`) with its named view; judged side by side against `engine-reference/godot/tuto_3d3.png` and `tuto_3d5.png`, it reads as Godot's. Its sky is the kit's, which is Godot's own `ProceduralSkyMaterial` default; under Godot's Filmic curve it lands the floor on Godot's (62, 51, 40), measured, without fitting.

The layer is the named view `godot` (`@volter/editor-game` `contributions/godot.view.ts`), which a person puts on a view from the shading popover's View row or `editor.presentation(id, 'godot')`.

Unity's default Scene view is its style (`@volter/editor-game` `unity.style.ts`) with its named view; judged against `engine-reference/unity/PrimitiveCube.png` and `NewEmptyScene_01.png`, it reads as Unity's in form (its sky's colours are fitted to the frames, not transcribed).

The layer is the named view `unity` (`@volter/editor-game` `contributions/unity.view.ts`), which a person puts on a view from the shading popover's View row or `editor.presentation(id, 'unity')`.

Unreal's default viewport is its style (`@volter/editor-game` `unreal.style.ts`) with its named view; judged against `engine-reference/unreal/default-interface.png`, it has Unreal's form in the gizmo, the outline, the world's orientation and the triad, but its cloudless sky and square plane handles keep it from being named Unreal's at a glance.

The layer is the named view `unreal` (`@volter/editor-game` `contributions/unreal.view.ts`), which a person puts on a view from the shading popover's View row or `editor.presentation(id, 'unreal')`.

Independent judgement (an opus judge, frames captured through `captureActiveDocument` on a selected object, against `engine-reference` and Blender's `gizmo-*.png`): **Godot, Unity and Unreal pass**; Blender does not. Each target is captured with its document opened under its own view, so the stage arms that view's boot tool; a view put on a document already open keeps the tool that was armed.

- Unreal passes with its cloud layer and preview floor (`contributions/unreal.view.ts`; sky, cloud and floor values fitted to `level-editor.png`). Remaining: the object's shadow on the floor is faint beside the reference's, the floor meets the sky on a hard line where Unreal's fog softens it, and the Move gizmo's arrows are short and thin.
- Unity's arrows are short with small cones next to its Move tool's.
- Blender lacks the 3D cursor and the origin dot. (The judge also read the floor lines on the cube's lower half as drawn through it; the default cube straddles the floor, so those lines lie in front of it, as in Blender's own perspective view.)
- The judged frames came from `captureActiveDocument`, the document's own render, which leaves out the viewport's overlay pass: every target's navigation gizmo is drawn on screen (Unreal's triad, seen through `captureEditorChrome`) but was missing from those frames. Judge a stage from the page capture, cropped to its viewport.
- Blender's Material Preview passes on the cube's shading and the backdrop against Blender 5.2's own render of the same world.

Blender's Material Preview is the named view `blender-material-preview` (`@volter/editor-blender` `contributions/material-preview.view.ts`) over Blender's eight world studio lights (`blender.environment.ts`, CC0). On `cube.blend` its faces measure 186–202 where Blender 5.2's own EEVEE render of the default cube under the same world, composited over the fill, measures 190–198; that render stands in for a viewport screenshot and is not an independent judgement. Both readings re-run from the installed Blender: `docs/reference-probes/blender-view3d-shading.py` prints the factory Material Preview settings the view transcribes, and `blender-material-preview-render.py` makes the reference render.

Neither half is accepted: Unreal and Blender above, Unreal's capability row, and Blender's Rendered mode. The reference frames are in `/Volumes/PeakSSD/volter-work/engine-reference`; the world stage is compiled but not yet seen on a project with a world.
