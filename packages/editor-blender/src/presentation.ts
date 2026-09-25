/**
 * HOW THE BLENDER STAGE BEHAVES, as its starting presentation (`@volter/editor-sdk/kit/
 * viewport-presentation`): this package builds the `model` stage, so it states the stage's
 * function there, beneath every person's choice and never in the look (ARCHITECTURE.md rule 7).
 */
import { registerStartingPresentation } from '@volter/editor-sdk/kit/viewport-presentation';

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
