/**
 * WHAT A WEB EXPORT'S DUMP HOLDS, shared by the editor that writes it
 * (`../contributions/blender-export.command.ts`), the CLI that builds the page from it
 * (`cyclotron export web`) and the page that plays it (`web-player.ts`).
 *
 * The dump is a folder in the project (`WEB_EXPORT_DUMP_DIR`, under the ignored `.volter/`):
 *
 * - `scene.frame.bin` — the model as `BlenderRuntimeView.exportFrame()` answers it, in the
 *   binary-safe frame file (`frame-codec.ts`): the copy a game plays, built with `applyFrame`.
 * - `clips.json` — every action baked for every armature (`WebExportClips`), so the page poses
 *   characters with the editor's own evaluator and never asks Blender.
 * - `export.json` — the rest (`WebExportManifest`): the model and its play script, the scene's
 *   display transform, its camera and the project's resolution.
 */
import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import type { BlenderDisplaySettings } from '@volter/blender-engine/browser/three/blender-display-transform';

/** The dump folder, project-relative. */
export const WEB_EXPORT_DUMP_DIR = '.volter/export/web';
export const WEB_EXPORT_FRAME_FILE = 'scene.frame.bin';
export const WEB_EXPORT_CLIPS_FILE = 'clips.json';
export const WEB_EXPORT_MANIFEST_FILE = 'export.json';
export const WEB_EXPORT_FORMAT = 1;

export interface WebExportManifest {
  readonly format: typeof WEB_EXPORT_FORMAT;
  /** The model's `.blend` and its play script, project-relative. */
  readonly blend: string;
  readonly script: string;
  /** Blender's display transform for the scene (`view_settings`); null draws Standard. */
  readonly display: BlenderDisplaySettings | null;
  /** The camera a view through the scene camera looks through (`view3d.view_camera`); null without one. */
  readonly camera: string | null;
  /** The project's `resolution` (its manifest), the game's intended frame; null when it names none. */
  readonly resolution: { readonly width: number; readonly height: number } | null;
  readonly exportedAt: string;
}

/**
 * Every armature × every action, baked once per skeleton as Play shares them: `armatures[name][action]`
 * is an index into `clips` (whose entry is null when Blender answered that the action animates
 * none of its bones), or the reason it could not be read.
 */
export interface WebExportClips {
  readonly format: typeof WEB_EXPORT_FORMAT;
  readonly clips: readonly (BlenderActionClip | null)[];
  readonly armatures: Readonly<Record<string, Readonly<Record<string, number | string>>>>;
}
