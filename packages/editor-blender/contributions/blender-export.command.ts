/**
 * THE WEB EXPORT'S DUMP (`blender-export-play`, a `workspace.command` verb): what a model's game
 * needs to play as a page of its own, with no Blender and no editor, written into the project for
 * `cyclotron export web` to build the page from (`../web-export/web-export-files.ts`).
 *
 * - THE MODEL is the frame Play's detached copy is built from (`BlenderRuntimeView.exportFrame`):
 *   meshes with their skins, armatures with their NLA, materials and node graphs, image bytes,
 *   lights, cameras and World.
 * - THE CLIPS are every action baked for every armature, read from Blender as Play reads them
 *   (`blenderActionClip`), once per skeleton and action: armatures with the same bones share a
 *   bake unless the action has several object slots, exactly as Play's clip cache shares them
 *   (`blender-play-skin.ts`). Play bakes lazily; a page cannot, so all are baked here.
 * - THE REST: the scene's display transform, the scene camera, the project's resolution.
 *
 * It answers the folder, the files and their sizes, and every clip that could not be read.
 * `document` names the model document; absent, the model on screen.
 */
import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import { blenderModelView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import type { CommandContribution, EditorCommandResult } from '@volter/sdk/commands';
import { editorHost } from '@volter/sdk/host';
import { blenderActionClip, blenderSceneMovie } from '../host/blender-runtime-host';
import { modelDocumentSource, servedModelDocument } from '../src/play-mode';
import { encodeFrameFile } from '../web-export/frame-codec';
import {
  WEB_EXPORT_CLIPS_FILE, WEB_EXPORT_MOVIE_FILE,
  WEB_EXPORT_DUMP_DIR,
  WEB_EXPORT_FORMAT,
  WEB_EXPORT_FRAME_FILE,
  WEB_EXPORT_MANIFEST_FILE,
  type WebExportClips,
  type WebExportManifest,
} from '../web-export/web-export-files';
import { readBlenderDisplaySettings } from './blender-display-settings';

export const point = 'workspace.command';

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The project's `resolution`, read from its manifest; null when it states none. */
async function projectResolution(): Promise<WebExportManifest['resolution']> {
  try {
    const manifest = JSON.parse(await editorHost().files.read('volter.project.json')) as { resolution?: { width?: unknown; height?: unknown } };
    const { width, height } = manifest.resolution ?? {};
    return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}

/** Every armature × every action, baked as Play would bake them (see the header). */
async function bakeClips(): Promise<{ clips: WebExportClips; failed: string[] }> {
  const facts = blenderModelView.animationFacts();
  const actions = Object.keys(facts.actions).sort();
  const clips: (BlenderActionClip | null)[] = [];
  const armatures: Record<string, Record<string, number | string>> = {};
  const failed: string[] = [];
  /** A clip by skeleton and action, as Play's shared cache keys it. */
  const shared = new Map<string, number>();
  for (const [name, armature] of Object.entries(facts.armatures).sort(([a], [b]) => a.localeCompare(b))) {
    const table: Record<string, number | string> = {};
    armatures[name] = table;
    const skeleton = armature.bones.map((bone) => bone.name).sort().join('\u0001');
    for (const action of actions) {
      const key = `${action}\u0000${skeleton}`;
      const known = shared.get(key);
      if (known !== undefined) {
        const clip = clips[known] ?? null;
        // A clip whose slot Blender picked for its armature among several is never another's.
        if (!(clip && (clip.objectSlots ?? 2) > 1 && clip.armature !== name)) { table[action] = known; continue; }
      }
      try {
        const clip = await blenderActionClip({ object: name, action, summary: false });
        if (clip === null) throw new Error("Blender's session is not started");
        clips.push(clip);
        table[action] = clips.length - 1;
        if (known === undefined) shared.set(key, clips.length - 1);
      } catch (error) {
        table[action] = `it could not be read: ${message(error)}`;
        failed.push(`${name} / ${action}: ${message(error)}`);
      }
    }
  }
  return { clips: { format: WEB_EXPORT_FORMAT, clips, armatures }, failed };
}

async function exportPlay(command: Record<string, unknown>): Promise<EditorCommandResult> {
  const named = command['document'];
  if (named !== undefined && typeof named !== 'string')
    return { ok: false, error: `blender-export-play's document is a model document id, a string; it was given ${JSON.stringify(named)}.` };
  const documentId = named ?? servedModelDocument();
  if (documentId === null) return { ok: false, error: 'No model document is open: open the .blend whose game you are exporting, then export again.' };
  const blend = modelDocumentSource(documentId) ?? modelDocumentSource(documentId.replace(/#.*$/, ''));
  if (!blend) return { ok: false, error: `${documentId} has no .blend file of its own, so it has no play script to export.` };
  if (blenderModelView.snapshot() === null)
    return { ok: false, error: `${blend} has not been presented yet: wait for the model to show, then export again.` };
  const script = blend.replace(/\.blend$/i, '') + '.play.ts';
  const files = editorHost().files;
  if (!(await files.exists(script))) return { ok: false, error: `${blend} has no play script (${script}); a web export plays a model's game.` };

  const frame = encodeFrameFile(blenderModelView.exportFrame());
  const { clips, failed } = await bakeClips();
  let display: WebExportManifest['display'] = null;
  try { display = await readBlenderDisplaySettings(); }
  catch (error) { return { ok: false, error: `The scene's display transform cannot be exported: ${message(error)}` }; }
  const manifest: WebExportManifest = {
    format: WEB_EXPORT_FORMAT,
    blend,
    script,
    display,
    camera: blenderModelView.cameraViewCamera(),
    resolution: await projectResolution(),
    exportedAt: new Date().toISOString(),
  };
  // THE MOVIE, for the game's cutscenes and sequences: sampled by Blender once, as Play reads it.
  const movieText = JSON.stringify(await blenderSceneMovie());
  const clipsText = JSON.stringify(clips);
  const manifestText = JSON.stringify(manifest, null, 2);
  await files.write(`${WEB_EXPORT_DUMP_DIR}/${WEB_EXPORT_FRAME_FILE}`, frame);
  await files.write(`${WEB_EXPORT_DUMP_DIR}/${WEB_EXPORT_CLIPS_FILE}`, clipsText);
  await files.write(`${WEB_EXPORT_DUMP_DIR}/${WEB_EXPORT_MOVIE_FILE}`, movieText);
  // Written last: its presence says the dump beside it is whole.
  await files.write(`${WEB_EXPORT_DUMP_DIR}/${WEB_EXPORT_MANIFEST_FILE}`, manifestText);
  return {
    ok: true,
    data: {
      dir: WEB_EXPORT_DUMP_DIR,
      documentId,
      blend,
      script,
      files: {
        [WEB_EXPORT_FRAME_FILE]: frame.byteLength,
        [WEB_EXPORT_CLIPS_FILE]: clipsText.length,
        [WEB_EXPORT_MOVIE_FILE]: movieText.length,
        [WEB_EXPORT_MANIFEST_FILE]: manifestText.length,
      },
      armatures: Object.keys(clips.armatures).length,
      actions: Object.keys(blenderModelView.animationFacts().actions).length,
      bakes: clips.clips.length,
      failed,
    },
  };
}

export const commands: CommandContribution['commands'] = {
  // Every clip of every armature is read from Blender, about a second and a half each.
  'blender-export-play': {
    timeoutMs: 30 * 60_000,
    derivedRefresh: 'none',
    handle: (command) => exportPlay(command as Record<string, unknown>),
  },
};
