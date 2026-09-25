/**
 * `@volter/editor-threejs`'s server half (`package.json#vgai.serving`): the animation stamp that
 * lets the editor drive the mixers a project's own code makes, and the conversion of source model
 * formats to runtime GLB for the asset library's imports.
 */

import type { ProjectServingServices } from '@volter/editor-sdk/session/project-serving';
import { animationStampPlugin } from './animation-stamp';
import { threeModelConverter } from './model-import-conversion';

export const servingPlugins = (services: ProjectServingServices): readonly unknown[] => {
  services.registerModelConverter(threeModelConverter);
  return [animationStampPlugin(services)];
};
