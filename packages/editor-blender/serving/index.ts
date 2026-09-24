/**
 * `@volter/editor-blender`'s server half (`package.json#vgai.serving`, the project-serving door in
 * `@volter/editor-sdk/session/project-serving`): the routes the Blender in the tab reads and
 * writes through.
 */

import type { ProjectServingModule } from '@volter/editor-sdk/session/project-serving';
import { blenderRoutesPlugin } from './blender-routes';

export const servingPlugins: ProjectServingModule['servingPlugins'] = (services) => [blenderRoutesPlugin(services)];
