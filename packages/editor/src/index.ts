import blender from 'vgai:contributions/@volter/editor-blender';
import { product } from '@volter/editor-core/frame/product';

export const { mountVgai } = product({
  id: 'editor',
  packages: { '@volter/editor-blender': blender },
  look: 'blender',
  workspace: 'model',
});
