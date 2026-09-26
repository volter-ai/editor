import blender from 'vgai:contributions/@volter/editor-blender';
import threejs from 'vgai:contributions/@volter/editor-threejs';
import { product } from '@volter/editor-core/frame/product';
import { prefetchBlenderArtifacts } from '@volter/blender-engine/browser';

// The Model Editor always opens a model, so Blender's engine is fetched as
// the frame loads, beside the workbench's own start, not when the Model
// document mounts: on a first open its 139 MB through a tab's server were the
// longest step on the way to the model's first read (2026-09-26).
void prefetchBlenderArtifacts();

export const { mountVgai } = product({
  id: 'model-editor',
  packages: { '@volter/editor-blender': blender, '@volter/editor-threejs': threejs },
  look: 'blender',
  workspace: 'model',
});
