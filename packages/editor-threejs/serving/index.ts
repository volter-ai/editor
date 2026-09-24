/**
 * `@volter/editor-threejs`'s server half (`package.json#vgai.serving`): the animation stamp that
 * lets the editor drive the mixers a project's own code makes.
 */

import { animationStampPlugin, type AnimationServingServices } from './animation-stamp';

export const servingPlugins = (services: AnimationServingServices): readonly unknown[] => [animationStampPlugin(services)];
