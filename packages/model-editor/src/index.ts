import brand from 'vgai:contributions/@volter-ai/brand';
import blender from 'vgai:contributions/@volter/editor-blender';
import threejs from 'vgai:contributions/@volter/editor-threejs';
import { product } from '@volter/editor-core/frame/product';

export const { mountVgai } = product({
  id: 'model-editor',
  // `@volter-ai/brand` is OPTIONAL (package.json#optionalDependencies): the Volter brand's
  // Plotter style, composed only when this build's install has the private package.
  packages: {
    '@volter/editor-blender': blender,
    '@volter/editor-threejs': threejs,
    '@volter-ai/brand': brand,
  },
  look: 'blender',
  workspace: 'model',
});
