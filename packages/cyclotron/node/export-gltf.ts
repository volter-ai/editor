/**
 * `export gltf [folder] [--out <file.gltf>]` — A MODEL AND ITS ANIMATION AS GLTF, for another engine
 * (`docs/SCENE-ANIMATION.md` step 6): the editor writes the presented model with every armature's
 * actions, the scene's movie (objects, cameras, shape keys) and its keyed materials
 * (`KHR_animation_pointer`), the clips the editor itself plays (`blender-export-gltf`, in
 * `@volter/editor-blender`). The model is the one open in the project's running editor.
 */
import { dirname, relative, resolve, sep } from 'node:path';
import { hasManifest } from '@volter/project/manifest/locate';

export const EXPORT_GLTF_USAGE = 'export gltf [folder] [--out <file.gltf>]';

export interface ExportGltfOptions {
  readonly out?: string | undefined;
  readonly log?: (line: string) => void;
}

function projectOf(folder: string): string {
  for (let dir = resolve(folder); ; dir = dirname(dir)) {
    if (hasManifest(dir)) return dir;
    if (dirname(dir) === dir) throw new Error(`export gltf: ${resolve(folder)} is not inside a project (no volter.project.json).`);
  }
}

export async function exportGltf(folder: string, options: ExportGltfOptions = {}): Promise<{ out: string }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const project = projectOf(folder);
  let out: string | undefined;
  if (options.out !== undefined) {
    const inside = relative(project, resolve(options.out));
    if (inside.startsWith('..') || resolve(inside) === inside) throw new Error(`export gltf: --out ${options.out} is outside the project ${project}.`);
    if (!/\.gltf$/i.test(inside)) throw new Error('export gltf: --out names a .gltf file.');
    out = inside.split(sep).join('/');
  }
  log('Asking the editor for the model and its animation…');
  const { connect } = await import('@volter/live');
  const { editor } = await connect(project);
  const answer = await editor.blender<{ ok?: boolean; error?: string; out?: string; blend?: string; bytes?: number; animations?: readonly string[];
    pointers?: number; skipped?: readonly string[]; failed?: readonly string[]; ms?: number }>('blender-export-gltf', out === undefined ? {} : { out });
  if (answer.ok === false) throw new Error(`export gltf: ${answer.error ?? 'the editor refused the export'}`);
  log(`Exported ${answer.blend} to ${answer.out}: ${((answer.bytes ?? 0) / 1048576).toFixed(1)} MB, ${answer.animations?.length ?? 0} animation(s), ${answer.pointers ?? 0} material channel(s), in ${((answer.ms ?? 0) / 1000).toFixed(1)} s`);
  for (const name of answer.animations ?? []) log(`  ${name}`);
  for (const thing of answer.skipped ?? []) log(`  not written: ${thing}`);
  for (const failure of answer.failed ?? []) log(`  could not be read: ${failure}`);
  return { out: resolve(project, answer.out ?? '') };
}
