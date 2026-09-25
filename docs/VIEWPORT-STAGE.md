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
| Axis colours | X and Y only (`color.viewport.axisX`, `axisY`) | no Z, no alpha, no centre colour |
| Selection | colour and active colour (`color.viewport.selection`, `active`) | outline only; no box-corner style, no children colour, fixed width |
| Scene light when the scene has none | no | key `DirectionalLight(0xffffff, 1.9)` in the dressing; editor rig ambient 0.5 and directional 1.0 (`editor-viewport.ts`) |
| Environment and its strength | no | RoomEnvironment at a fixed strength (`StageHost.tsx`) |
| Tone mapping and exposure | no | ACES Filmic unless a document states its own |
| Gizmo size, shelf tool | yes (`density.viewport`) | |

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
- overlays: the selection marks (outline, wire, box, in any combination) and the grid's major step; the look states the grid's line widths and major contrast (`density.viewport`);
- `editor.presentation(documentId, layer?)` reads and records a view's presentation, and reports what its last draw was lit by.

Capability, per target (can its default viewport and its toggles be expressed without new code):

| Target | Expressible now | Not yet |
|---|---|---|
| Blender | Solid (its own studio, AgX, no environment), the fill, outline, grid step and widths | Material Preview's HDRI (only a procedural sky exists), Rendered (the engine's render lighting is not a scene light the stage can switch to), box and wire on Blender documents (its selection ids are datablocks, not three objects) |
| Godot | preview sun and sky, sky as backdrop, 8-cell major step | its selection box as the full AABB (ours draws corner brackets), per-part takeover (the sun and the environment give way separately; `auto` switches the whole source), its Filmic curve (AgX stands in), the sun's energy unit, XY and YZ grid planes |
| Unity | scene lighting, outline plus wire, a camera-locked headlight as a preset | the skybox toggle as a backdrop source over a scene without a skybox, Prefab Mode's context fill, per-mode lighting of draw modes |
| Unreal | the level's own sky and lights (`scene` sources), an outline | the outline's width and colour as look values; not measured beyond its frames |

Neither half is accepted. The reference frames are downloaded (`/Volumes/PeakSSD/volter-work/engine-reference`); the targets' looks are still to be authored and judged side by side against them; the world stage is compiled but not yet seen on a project with a world.
