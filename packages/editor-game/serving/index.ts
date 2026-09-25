/**
 * `@volter/editor-game`'s server half (`package.json#vgai.serving`): the one deep specifier a
 * game's own contributions name, `@editor/game-module-access` (the template's
 * `src/contributions/use-game-modules.ts`), resolved to this package's module. The page
 * bundle maps the same specifier for its own copy (`src/host/served-bundle-runtime-modules.ts`);
 * a contribution the session's Vite serves needs the file.
 */

import { fileURLToPath } from 'node:url';
import type { ProjectServingServices } from '@volter/editor-sdk/session/project-serving';

const GAME_MODULE_ACCESS = '@editor/game-module-access';
/** The kit's `@editor/*` alias runs before any plugin and rewrites the specifier to the kit's
 *  own `src/`, where this module no longer lives; that form is this package's too. */
const ALIASED_GAME_MODULE_ACCESS = /\/editor-core\/src\/game-module-access$/;

export const servingPlugins = (_services: ProjectServingServices): readonly unknown[] => [
  {
    name: 'volter-editor-game:game-module-access',
    enforce: 'pre',
    resolveId(id: string): string | null {
      return id === GAME_MODULE_ACCESS || ALIASED_GAME_MODULE_ACCESS.test(id)
        ? fileURLToPath(new URL('../src/host/game-module-access.ts', import.meta.url))
        : null;
    },
  },
];
