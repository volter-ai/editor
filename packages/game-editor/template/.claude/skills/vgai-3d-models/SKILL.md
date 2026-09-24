---
name: vgai-3d-models
description: Model and revise game props with ordinary Blender Python through the Blender MCP and export the asset for a reusable Three.js prefab. Use when asked to model a prop, shape, machine, or other game object. For placement, stories and gameplay use vgai-3d-assets; for procedural geometry generated during gameplay use ordinary Three.js.
---

# Model a game asset

You are using **Blender in the browser** through the project's Blender MCP.
Use `execute_blender_code`, `get_scene_info`, `get_object_info`, and
`get_viewport_screenshot` with ordinary `bpy`, `bmesh` and `mathutils` Python.
Blender coordinates are **Z-up**, distances are metres, and angles are radians.

Start the game's editor with `npm run dev` **in the background**, keep it running
while authoring, and tell the user its URL. Connect the project's `blender`
server in `.mcp.json` (`npm run --silent vgai -- blender-mcp`).
The **Model** document is your Blender viewport; the **Scene** composes game
objects. Inspect the model there, then inspect its placement in the game.

## Model, inspect, refine

Work normally in Blender through MCP. Inspect the scene, construct and revise the
asset, and check screenshots and object bounds as you work. Use meaningful object
names, parenting and local origins for parts the game must manipulate separately.
Use project-relative paths for input assets and exports.

## Export and place

Export the intended asset to `public/models/<asset>.glb` using
`bpy.ops.export_scene.gltf`, normally `export_format='GLB'`,
`use_selection=True`, `export_apply=True`. Select only its intended objects.
The exporter converts Blender's Z-up to glTF's Y-up; do not rotate it again.
Inspect the exported asset in the game's lighting: a Blender render alone does
not prove the game appearance, textures, rig or animations survived export.

Create `src/prefabs/<Asset>.tsx` and a colocated CSF story, following the
starter's `HeroBox.tsx` / `HeroBox.stories.tsx` shape. Use ordinary drei
`useGLTF` and `Clone` for a static model so two placements get separate object
instances. The public asset is addressed as `/models/<asset>.glb`.
The prefab owns collisions, interactions and named attachment points. Its story
makes it discoverable in Content. The scene places the prefab.

For an asset revision, edit it in Blender and re-export to the same asset path.
Check its game placements and preserve the selected starter's studio and
verification requirements. Before handoff, run the game's build and inspect the
exported game. Keep input assets and runtime exports in version control;
keep scratch files in `.vgai/tmp/`.

For animation and skinning, also read `vgai-animation-assets`; a static mesh
export is not proof that an animated character is game-ready.

## Where the model lives

A model is a `.blend` under `src/models/`, and the bpy script that authored it
is an ordinary project file beside it (`cube.blend` / `cube.py`) — the script
is the asset's SOURCE, the `.blend` is what the Model document opens, and the
session saves the document about a second after your last call. Author through
this MCP; the document does not run your script for you.

## When geometry generation is gameplay

Use ordinary Three.js/R3F in the game for runtime procedural geometry — that
is gameplay, not an asset. Existing TypeScript model builders stay project-owned
code; for an operation's exact TypeScript signature, look up its one row in
Blender's own `bpy.ops.mesh` / `bmesh.ops` documentation — this skill deliberately keeps no second table of them.
