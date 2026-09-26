/**
 * HOW THE BLENDER STAGE BEHAVES, as its starting presentation (`@volter/editor-sdk/kit/
 * viewport-presentation`): this package builds the `model` stage, so it states the stage's
 * function there, beneath every person's choice and never in the look (ARCHITECTURE.md rule 7).
 */
import { DOCUMENT_STUDIO_PRESET, registerStartingPresentation } from '@volter/editor-sdk/kit/viewport-presentation';

const release = registerStartingPresentation('model', {
  interaction: {
    // BLENDER'S SHELF OPENS ON SELECT BOX, so a selected object carries no transform gizmo until
    // one of the four transform tools is armed (`space_toolsystem_toolbar.py`:
    // `_defs_view3d_generic.select_box` is the first entry of the Object Mode `_tools_default`
    // tuple). Photographed at the engine's pin: `gizmo-select-box.png` has Select Box lit in the
    // shelf, the default cube selected and outlined, and nothing at its origin but the 3D cursor
    // and the object dot; `gizmo-move.png` has Move lit in the same frame.
    bootTool: 'select',
    // BLENDER'S SELECT BOX IS A TOUCH TEST: its object-mode box select reads the object-id buffer
    // under the rectangle, so any drawn part of an object inside it selects that object.
    boxSelect: 'touch',
  },
  // BLENDER'S SHADING TYPES EACH KEEP THEIR OWN LIGHTING, and switching the header's shading cell
  // switches to that type's (`View3DShading` keeps `studio_light` for Solid, `studio_light` /
  // `studiolight_*` for Material Preview, and Rendered lights by the scene). So they are stated per
  // draw mode, and a person's Lighting choice is the current mode's (`stageLightsPerMode`).
  // SOLID (`clay`, and Wireframe with it) is lit by Blender's four studio lights, the document's
  // view-locked studio, and drawn under STANDARD: Blender gives Solid the display's default view
  // and none of the scene's settings (`draw_color_management.cc`, `ViewTransform`), and the sRGB
  // display's default is Standard (`config.ocio`). Blender 5.2's Workbench under Standard gives
  // the factory cube 142 / 131 / 112 in the default view and 162 on the front face, agreeing with
  // the viewport's own frames (141 / 129 / 111, 161). The scene's AgX is the two modes' below.
  all: {
    lighting: {
      source: 'studio',
      studioPreset: DOCUMENT_STUDIO_PRESET.id,
      auto: null,
      tone: { mapper: 'none', exposure: 1 },
    },
    // X-Ray per shading type, read back from Blender 5.2's factory View3DShading: Solid's off at
    // 0.5 (`show_xray`, `xray_alpha`), Wireframe's on at 0 (`show_xray_wireframe`,
    // `xray_alpha_wireframe`) — a wireframe with no surface.
    xray: { enabled: false, alpha: 0.5 },
  },
  modes: {
    wireframe: { xray: { enabled: true, alpha: 0 } },
    // MATERIAL PREVIEW: the scene lit by a world studio light alone, Forest at strength 1 and
    // rotation 0, fixed in the world, drawn over the viewport's own colour, in AgX. Read from
    // Blender 5.2's factory View3DShading: `studio_light` Default (forest.exr),
    // `studiolight_intensity` 1, `studiolight_rotate_z` 0, `studiolight_background_alpha` 0,
    // `use_studiolight_view_rotation` (World Space Lighting) on, `use_scene_lights` off
    // (`docs/reference-probes/blender-view3d-shading.py`). The images are `blender.environment.ts`'s.
    // Blender's viewport never changes its shading on its own: a lamp does not take it over.
    preview: {
      lighting: {
        source: 'preview',
        auto: null,
        preview: {
          sceneLights: false,
          sun: { enabled: false },
          environment: { enabled: true, image: 'blender:forest', energy: 1, rotation: 0 },
        },
        tone: { mapper: 'agx', exposure: 1 },
      },
      backdrop: { source: 'fill' },
    },
    // RENDERED: the scene's own lights and World, drawn behind the model, in AgX — the lighting the
    // document's render photographs with (`BlenderRuntimeView.holdRendered`). Not a path tracer:
    // the viewport and a render agree because they are one drawing.
    rendered: {
      lighting: { source: 'scene', auto: null, tone: { mapper: 'agx', exposure: 1 } },
      backdrop: { source: 'scene' },
    },
  },
  overlays: {
    // BLENDER DRAWS THE SELECTED OBJECTS' ORIGINS (Overlays › Origins, on by default): the dot at
    // the default cube's centre in every reference frame (`gizmo-select-box.png`).
    selection: { origins: true },
  },
  world: {
    // BLENDER'S WORLD IS Z-UP, and the stage presents it through the signed permutation
    // `(x, y, z) → (x, z, −y)` the presented root carries (`blender-runtime-view.ts`'s
    // constructor). So three's Y is Blender's Z and three's Z is Blender's −Y, and the transform
    // gizmo's colours, the side each arm is drawn on, the plane squares and the navigation
    // gizmo's six labels all say so: the arm that points up is Z and it is blue.
    upAxis: 'z',
  },
});

// A contribution module re-evaluates on a hot update; release the registration first.
if (import.meta.hot) import.meta.hot.dispose(release);
