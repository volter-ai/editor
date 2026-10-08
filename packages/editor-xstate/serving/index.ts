/**
 * `@volter/editor-xstate`'s server half (`package.json#volter.serving`, the project-serving door in
 * `@volter/sdk/session/project-serving`): the machine identity stamp and the
 * `/__xstate-source/*` routes.
 */

import type { ProjectServingModule } from '@volter/sdk/session/project-serving';
import { xstatePlugin } from './xstate-plugin';

export const servingPlugins: ProjectServingModule['servingPlugins'] = (services) => [xstatePlugin(services)];
