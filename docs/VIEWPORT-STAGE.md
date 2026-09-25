# The viewport stage and its targets

Rule 6 of [ARCHITECTURE.md](../ARCHITECTURE.md) says a component is themable only when it can be themed into each of several real targets. For the 3D viewport the targets are Blender, Unity, Godot and Unreal. This page records what each target's default editor viewport is made of, with a source for every value, and what a look can declare today.

## The targets' default viewports

Measured from the engines' own sources, 2026-09-25. Colours are sRGB; a fourth value is alpha.

| Property | Blender 5 (`userdef_default_theme.c`, `space_view3d`) | Godot 4.4 (`editor_settings.cpp`, `node_3d_editor_plugin.cpp`, `editor_theme_manager.cpp`) | Unity 6 (UnityCsReference: `SceneView.cs`, `SceneViewGrid.cs`, `Handles.cs`) | Unreal 5 |
|---|---|---|---|---|
| Backdrop | flat `#3d3d3d`; the theme also offers linear and radial gradients to `back_grad` `#303030` | procedural preview sky: top `(0.385, 0.454, 0.55)`, ground `(0.2, 0.169, 0.133)`, horizon derived from the two (their mix, pulled halfway to its own luminance x 3.333) | the scene's skybox (a new scene's procedural sky); flat `(0.278, 0.278, 0.278)` with the skybox off; `(0.132, 0.231, 0.330)` in Prefab Mode | not measured |
| Light when the scene has none | none; Solid shading lights by studio light (a matcap-like preset), no scene light | preview sun: white, energy 1, altitude 60°, azimuth 150°, shadows to 100 m; sky energy 1 | a new scene's own Directional Light and the skybox's ambient | not measured |
| Tone and post | Solid mode draws unlit studio shading, no tone mapper | filmic tone mapper on, glow on, SSAO off, SDFGI off | none by default | not measured |
| Grid | minor `#545454` at alpha 0.5, major `#545454`; axis lines at `grid_axis_brightness` 0.46 | primary `(0.56, 0.56, 0.56, 0.5)`, secondary `(0.38, 0.38, 0.38, 0.5)`, 8 primary steps; XY, XZ and YZ planes toggle separately | `(0.5, 0.5, 0.5, 0.4)` | not measured |
| Axis colours | X `#ff3352`, Y `#8bdc00`, Z `#2890ff` | X `(0.96, 0.20, 0.32)`, Y `(0.53, 0.84, 0.01)`, Z `(0.16, 0.55, 0.96)` | X `(219, 62, 29)`, Y `(154, 243, 72)`, Z `(58, 122, 248)`, each alpha 0.93; centre `(0.8, 0.8, 0.8)` | not measured |
| Selection | selected `#ed5700`, active `#ffa028`, outline width 1 | selection BOX (the AABB's corners) `(1.0, 0.5, 0)`; no mesh outline | outline `#ff6600`; selected children `(94, 119, 155)`; wireframe selected `(94, 119, 155, 64)` | not measured |

Unreal is not installed on this box, and its documentation does not state these defaults, so its column is empty until it is measured from the running editor.

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

## Proposal: the stage group a look declares

This section is a proposal drawn from the table above, not a ruling.

A look declares a `stage` group. Each field below is needed by at least one measured target, and the union covers all three:
- **backdrop**: `flat` (Blender, Unity with the skybox off), `gradient` linear or radial (Blender's other options, the kit's original), or `sky` with top, horizon and ground colours (Godot, Unity's default skybox); plus an optional per-mode backdrop (Unity's Prefab Mode);
- **light**: the fallback light used when the scene has none, as `studio` (Blender), `sun` with colour, energy, altitude, azimuth and shadow distance (Godot), or `none` (Unity, whose scenes carry their own); and an environment strength;
- **tone**: tone mapper (`none`, `filmic`, `aces`), exposure, and glow;
- **grid**: minor and major colours with alpha, major step (Blender 10, Godot 8), reach and fade, and which planes are on;
- **axes**: X, Y and Z colours with alpha, and the centre colour;
- **selection**: style (`outline` or `box`), selected, active and children colours, and width.

The kit's defaults become the kit's own original stage, the blue-slate gradient from before the Blender fitting. Blender's measured values move into `@volter/editor-blender`'s style. The group is accepted when a Blender, a Godot and a Unity look, each built only from values, are judged side by side against frames of the real editors. Unreal's look is added the same way once its column is measured.
