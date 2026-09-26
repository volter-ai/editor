import { product } from '@volter/editor-core/frame/product';
import { prebootBlender } from '@volter/blender-engine/browser';

// The Model Editor always opens a model, so Blender's engine is fetched and
// booted as the frame loads, beside the workbench's own start, not when the
// Model document mounts: on a first open its 139 MB through a tab's server
// were the longest step on the way to the model's first read, and on a warm
// one its 2.2 s boot began 2 s after the frame (2026-09-26). It is asked for
// before the contributions are, which are imported after it: a statement of
// this module runs only once its whole static graph has loaded, and the
// contributions' chunks put the boot 0.6 s later.
prebootBlender();

const [{ default: blender }, { default: threejs }] = await Promise.all([
  import('vgai:contributions/@volter/editor-blender'),
  import('vgai:contributions/@volter/editor-threejs'),
]);

export const { mountVgai } = product({
  id: 'model-editor',
  packages: { '@volter/editor-blender': blender, '@volter/editor-threejs': threejs },
  look: 'blender',
  workspace: 'model',
});
