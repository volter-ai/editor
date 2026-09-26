/**
 * The `bake` CONFIGURATION KIND (ARCHITECTURE-CORE §The project model): a
 * build-role configuration that bakes one project-authored Object3D module
 * into a GLB — the bake capability's own `project.bake.module` tool, run by
 * the host as a build. Declare one in `vgai.project.json`:
 *
 *   { "id": "cube-glb", "kind": "bake", "modulePath": "src/models/cube.ts", "name": "cube" }
 *
 * and `vgai build cage-glb` (or Export) bakes it. This module is a plain
 * object the HOST registers; it mounts no UI.
 */

import { z } from 'zod';

export const kind = {
  kind: 'bake',
  role: 'build',
  describe: 'Bake an Object3D module into a GLB (the bake capability\'s project.bake.module tool)',
  schema: z
    .object({
      id: z.string().min(1),
      kind: z.literal('bake'),
      modulePath: z.string().min(1).describe('Project-relative module exporting the builder'),
      exportName: z.string().min(1).optional().describe("The export to call (default: the module's default)"),
      name: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-_]{0,63}$/)
        .describe('Stable lowercase asset name for the GLB'),
    })
    .strict(),
  build: {
    tool: 'project.bake.module',
    input: (configuration: { modulePath: string; exportName?: string; name: string }) => ({
      modulePath: configuration.modulePath,
      exportName: configuration.exportName ?? 'default',
      name: configuration.name,
      dryRun: false,
    }),
  },
} as const;
