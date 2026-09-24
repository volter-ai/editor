/**
 * The `modelsFromBlendFiles` FINDER (ARCHITECTURE-CORE §The project model,
 * "A model is Blender data, and a prefab is not a model"): every `.blend`
 * under the selection's `include` globs is a `model` document — a Blender
 * file the engine in the tab opens, edits and saves. The bpy scripts that
 * authored it are ordinary project files beside it (`src/models/<name>.py`);
 * this document does not run them, a person or an agent does, through the
 * session's Blender (`vgai blender-mcp`).
 *
 * It replaced `modelsFromMeshModules`, which listed every module exporting
 * `build(): THREE.BufferGeometry` (owner ruling 2026-09-19, "do the delete":
 * the TypeScript mesh kit was the modeling engine while Blender could not run
 * in the tab; it now does, and a model is Blender data).
 *
 * Select it in `vgai.adapter.ts`:
 *
 *   documents: { find: [{ finder: 'modelsFromBlendFiles', include: ['src/models/**\/*.blend'] }] }
 *
 * THE SESSION'S OWN MODEL. A project that holds no `.blend` of its own still
 * needs ONE model — it is what `blender-start` presents into and what a first
 * bpy call models in, saved to the session's default `models/model.blend` — so
 * when the selection finds no file, the finder lists the standing
 * `blender:runtime` entry instead. Never beside a real model.
 *
 * This module is a plain object the HOST registers; it mounts no UI. It reads
 * the project only through `input.files` — the PATHS matching those globs.
 * Deliberately not `input.sources`: a `.blend` is binary, there is nothing in
 * it a text walk could honestly read, and the entry is the file itself.
 */

import { z } from 'zod';

export const finder = {
  name: 'modelsFromBlendFiles',
  schema: z
    .object({
      finder: z.literal('modelsFromBlendFiles'),
      include: z
        .array(z.string().min(1))
        .min(1)
        .describe('Project-relative globs of the Blender files to list (`src/models/**/*.blend`)'),
    })
    .strict(),
  run(
    _selection: { finder: 'modelsFromBlendFiles'; include: readonly string[] },
    input: { files?: readonly string[] },
  ) {
    const entries = [];
    const notes: string[] = [];
    for (const path of input.files ?? []) {
      if (!path.endsWith('.blend')) continue;
      const name = (path.split('/').pop() ?? path).replace(/\.blend$/, '');
      entries.push({
        id: `model:${path}`,
        label: name,
        kind: 'model',
        region: null,
        authorable: true,
        reach: { kind: 'root-mount' as const },
        source: { path },
      });
    }
    if (entries.length === 0) {
      entries.push({
        id: 'blender:runtime',
        label: 'Model',
        kind: 'model',
        region: null,
        authorable: true,
        reach: { kind: 'root-mount' as const },
      });
    }
    return { entries, notes };
  },
} as const;
