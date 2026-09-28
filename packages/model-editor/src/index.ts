import blender from 'volter:contributions/@volter/editor-blender';
import threejs from 'volter:contributions/@volter/editor-threejs';
import { product } from '@volter/editor-core/frame/product';

export const { mountVolter } = product({
  id: 'model-editor',
  packages: { '@volter/editor-blender': blender, '@volter/editor-threejs': threejs },
  look: 'blender',
  workspace: 'model',
  logo: 'https://brand.volter.ai/logo/volter-model-editor/svg',
});
