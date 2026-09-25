/**
 * The BLENDER layout — the composition a models project's adapter declares
 * (`vgai.adapter.ts`: `editor: { Layout: ModelLayout }`, the door
 * `@volter/editor-sdk/layouts` documents). `ModelArrangement` names the Model
 * workspace and the chrome regions it shows; Sculpt and Texture open on it too
 * — their reserved panels (the brush rail, the layer stack) ship WITH their
 * programs, never as empty chrome, and until then nothing about a sculpt
 * arrangement differs from a modeling one.
 *
 * WHERE THE PANELS SIT IS THE WORKBENCH'S. A workspace declares what it SHOWS
 * (`regions`) and which documents stand beside the centre one (`areas`); the
 * sizes, the splits and the tab order are the frame's editor-group state,
 * which VS Code persists itself. A captured grid used to ship here beside the
 * contribution, measured off Blender 5.2's own MODELING workspace; the
 * measurement that outlived it is `contributions/model.layout.ts`'s Timeline
 * RATIO, which is a proportion rather than a geometry and is stated there.
 */
import {
  EditorFooter,
  EditorFrame,
  EditorHeader,
  Workspace,
  type WorkspaceArrangement,
} from '@volter/editor-sdk/layouts';
import { BLENDER_REGIONS } from './regions';

export const ModelArrangement: WorkspaceArrangement = {
  id: 'model',
  title: 'Model',
  // `tabs` unstated — see `../contributions/model.layout.ts`.
  // Blender's areas (`./regions.ts`), as every Blender workspace carries them.
  regions: {
    ...BLENDER_REGIONS,
    drawer: 'hidden',
  },
};

/** Blender-shaped modeling; the game never takes the workspace over. */
export function ModelLayout() {
  return (
    <EditorFrame>
      <EditorHeader />
      <Workspace arrangement={ModelArrangement} immersivePlay={false} />
      <EditorFooter />
    </EditorFrame>
  );
}
