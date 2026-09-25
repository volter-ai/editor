import blender from 'vgai:contributions/@volter/editor-blender';
import threejs from 'vgai:contributions/@volter/editor-threejs';
import { product } from '@volter/editor-core/frame/product';

export const { mountVgai } = product({
  id: 'model-editor',
  packages: { '@volter/editor-blender': blender, '@volter/editor-threejs': threejs },
  look: 'blender',
  workspace: 'model',
});
