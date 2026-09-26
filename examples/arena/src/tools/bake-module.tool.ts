import { defineTool } from '@volter/editor-sdk/tools/registry';
import { z } from 'zod';
import {
  assertRenderableGeometry,
  buildFromModule,
  computeMeshStats,
  EMPTY_GEOMETRY_ERROR,
  EXPORT_NOT_CALLABLE_ERROR,
  MODULE_NOT_FOUND_ERROR,
  NOT_AN_OBJECT3D_ERROR,
  PATH_ESCAPES_PROJECT_ERROR,
} from '../contributions/module-source';
import { bakeObject3DSource } from '../lib/bake/object3d-bake';
import { disposeObject3D } from '../lib/bake/object3d-lifecycle';

// The module-loading step and its typed errors live in `module-source.ts`
// so `project.bake.preview` refuses an identical module for an identical reason.
export {
  EMPTY_GEOMETRY_ERROR,
  EXPORT_NOT_CALLABLE_ERROR,
  MODULE_NOT_FOUND_ERROR,
  NOT_AN_OBJECT3D_ERROR,
  PATH_ESCAPES_PROJECT_ERROR,
};

export const BlenderBuildInputSchema = z.object({
  modulePath: z
    .string()
    .min(1)
    .describe(
      'Project-relative (or absolute, inside the project) path to a TypeScript module that ' +
        'exports a builder function returning a native THREE.Object3D — typically assembled with ' +
        'the blender kit (`lib/mesh`).',
    ),
  exportName: z
    .string()
    .min(1)
    .default('default')
    .describe("Name of the module export to call. Defaults to the module's default export."),
  name: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-_]{0,63}$/)
    .describe('Stable lowercase asset name used for the generated GLB file.'),
  dryRun: z
    .boolean()
    .default(false)
    .describe('Build and validate the module output without writing project files.'),
});

const OutputFileSchema = z.object({
  path: z.string(),
  bytes: z.number(),
  mediaType: z.string().optional(),
  role: z.enum(['asset', 'provenance', 'other']).optional(),
});

export const BlenderBuildResultSchema = z.object({
  model: z.string(),
  provenanceOperationId: z.string().optional(),
  vertexCount: z.number(),
  triangleCount: z.number(),
  meshCount: z.number(),
  skinnedMeshCount: z.number(),
  boneCount: z.number(),
  animatedNodeCount: z.number(),
  clips: z.array(z.string()),
  files: z.array(OutputFileSchema),
  totalBytes: z.number(),
  dryRun: z.boolean(),
});

export const tool = defineTool({
  name: 'project.bake.module',
  summary: 'Bake a project-authored Object3D module into a GLB asset.',
  description:
    'Dynamically imports a project TypeScript module (a project module reference: `modulePath` + ' +
    '`exportName`), calls its exported builder to get a native THREE.Object3D — typically assembled ' +
    'with the blender kit (`lib/mesh`) — validates the geometry, and atomically writes an ' +
    'ordinary model. This is the agent/MCP-callable front door onto any project-owned ' +
    'Three.js source builder, mirroring the turntable tool’s `--module`/`--export` mechanism.',
  input: BlenderBuildInputSchema,
  result: BlenderBuildResultSchema,
  errors: [
    MODULE_NOT_FOUND_ERROR,
    EXPORT_NOT_CALLABLE_ERROR,
    NOT_AN_OBJECT3D_ERROR,
    EMPTY_GEOMETRY_ERROR,
    PATH_ESCAPES_PROJECT_ERROR,
  ],
  requires: { project: true },
  host: 'node',
  mutates: true,
  supportsDryRun: true,
  longRunning: true,
  permission: {
    risk: 'write',
    summary: 'Writes a generated GLB under public/ unless dryRun is set.',
  },
  async impl(input, ctx) {
    const projectRoot = ctx.projectRoot;
    if (!projectRoot) throw new Error('project.bake.module requires a project root.');
    const build = await buildFromModule(
      projectRoot,
      input.modulePath,
      input.exportName,
      ctx.loadProjectModule,
    );
    const root = build.root;
    const stats = computeMeshStats(root);
    assertRenderableGeometry(stats, input.modulePath, input.exportName);
    return bakeObject3DSource({
      ctx,
      name: input.name,
      dryRun: input.dryRun,
      // `Object3D.animations` is three's OWN carrier for the clips that belong
      // to a model — it is where `GLTFLoader` puts them, what `Object3D.copy`
      // carries across a clone, and what `useAnimations(scene.animations)`
      // reads. A model module that builds a rig and its actions therefore
      // returns them the ecosystem's way, with nothing new to declare; before
      // this line the module lane passed no animations at all and every clip a
      // builder authored was silently dropped from the GLB. (A build-result
      // export's separate `animations` list is written onto the root by
      // `buildFromModule`, so this reads one carrier for both shapes.)
      build: () => ({
        root,
        animations: root.animations,
        // The BUILDER's own teardown when it returned one — a rig holds mixers
        // and actions the generic graph walk cannot see.
        dispose: build.dispose ?? (() => disposeObject3D(root)),
      }),
      validation: {
        requireSkinned: false,
        forbidSkinned: false,
        minimumAnimatedNodes: 0,
      },
      inspectSource: () => stats,
    });
  },
});
