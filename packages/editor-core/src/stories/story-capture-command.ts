/**
 * THE STORY LANE OF `vgai screenshot` on the session wire:
 * `capture-story-variants`.
 *
 * Registered through `command-registry.ts` — the contributed-command registry
 * `command-listener.ts` asks before its own table — rather than as a row in
 * `command-table.ts`, because the verb carries its OWN relay budget and
 * refresh policy, and the generic 5 s default is what a sheet of stories
 * expires.
 *
 * THE BUDGET, and the reason it is not the default: a sheet's cost scales with
 * how many CSF exports the file declares, not with any single render, and a
 * real 10-story HUD file expired the default outright.
 *
 * WHAT THIS MODULE IS FOR, beside the work: validating the untrusted wire
 * payload at the boundary, the same discipline `capture-asset-preview` applies
 * to a shot-set definition. Deliberately NOT a mode of that verb — it
 * photographs 3D subjects through the Asset Lab's WebGL engine and its whole
 * flag vocabulary (stage, background, shot sets, silhouette compare) is
 * meaningless for DOM. Folding a DOM lane into it would earn one op name and a
 * permanent list of fields that apply to half of it.
 */

import type {
  CommandContribution,
  EditorCommandMessage,
  EditorCommandResult,
} from '@volter/editor-sdk/commands';
import { parseCameraChoice, parsePoseChoice } from '@volter/editor-sdk/kit/capture-camera-pose';
import { readProjectTextFile } from '@volter/editor-sdk/kit/editor-api';
import { getCurrentProject } from '@volter/editor-sdk/kit/project-manager';

/** What the registry reports a duplicate against. */
export const STORY_CAPTURE_COMMAND_SOURCE = 'packages/editor/src/stories/story-capture-command.ts';

const VERB = 'capture-story-variants';

async function handle(cmd: EditorCommandMessage): Promise<EditorCommandResult> {
  // A hidden tab cannot present frames: rAF is suspended and timers are
  // throttled, so a story mount's paint waits park until the human returns —
  // measured as a silent two-minute relay timeout. The look-verb rule is that
  // a capture refusal NAMES the failed layer; visibility is a reported fact,
  // so refuse on it up front with the remedy in the message.
  if (document.visibilityState === 'hidden') {
    return {
      ok: false,
      error:
        'story capture needs a PRESENTING tab — the editor tab is hidden, so the browser ' +
        'suspends the frames a story mount must paint. Bring the editor tab to the foreground ' +
        '(or unminimize its window) and re-run.',
    };
  }
  const modulePath = cmd['modulePath'];
  if (typeof modulePath !== 'string' || modulePath === '') {
    return { ok: false, error: `${VERB} requires a project-relative modulePath.` };
  }
  const story = cmd['story'];
  if (story !== undefined && typeof story !== 'string') {
    return { ok: false, error: `${VERB} story must be a CSF export name.` };
  }
  const dimension = (value: unknown, fallback: number, name: string): number => {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 64 || value > 1024) {
      throw new Error(`${VERB} ${name} must be an integer from 64 to 1024.`);
    }
    return value;
  };
  try {
    // The default mount box is the project's DECLARED resolution — the box
    // the game actually solves screen anchors against — read from the
    // manifest rather than a constant (zero inference). Explicit width/height
    // remain the caller's override; 960×540 is only the fallback for a
    // project that declares nothing.
    const declared = await (async (): Promise<{ width: number; height: number } | null> => {
      try {
        const text = await readProjectTextFile('vgai.project.json');
        if (!text) return null;
        const manifest = JSON.parse(text) as {
          resolution?: { width?: unknown; height?: unknown };
        };
        const w = manifest.resolution?.width;
        const h = manifest.resolution?.height;
        if (typeof w !== 'number' || typeof h !== 'number') return null;
        if (w < 64 || h < 64 || w > 4096 || h > 4096) return null;
        // CLAMPED TO THE RASTERIZER'S OWN CEILING. A three story is
        // photographed by `captureObjectAssetPreview`, whose
        // `checkedDimension` REFUSES anything past 1024 — so a project
        // declaring a 1280×720 resolution (the scaffold's own default) made
        // every 3D story's mount throw, fall through to the DOM leg, and
        // render R3F intrinsics as inert custom elements: the
        // whole-project-blank-sheet defect the lane's own doc comment exists
        // to prevent, re-entered through the DEFAULT rather than through a
        // bad override. The explicit width/height path already validates
        // against the same ceiling; only this inferred default could exceed
        // it. Measured on the chest driver project, 2026-08-29.
        return { width: Math.min(1024, Math.round(w)), height: Math.min(1024, Math.round(h)) };
      } catch {
        return null;
      }
    })();
    const width = dimension(cmd['width'], declared?.width ?? 960, 'width');
    const height = dimension(cmd['height'], declared?.height ?? 540, 'height');
    const cameraChoice = parseCameraChoice(VERB, cmd['camera']);
    if (typeof cameraChoice === 'string') return { ok: false, error: cameraChoice };
    const posedClip = parsePoseChoice(VERB, cmd['pose']);
    if (typeof posedClip === 'string') return { ok: false, error: posedClip };
    const { captureProjectStoryVariants } = await import('./story-capture');
    const capture = await captureProjectStoryVariants(getCurrentProject(), {
      modulePath,
      ...(story === undefined ? {} : { story }),
      width,
      height,
      ...(cameraChoice ? { camera: cameraChoice } : {}),
      ...(posedClip ? { pose: posedClip } : {}),
    });
    return { ok: true, data: { ...capture } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const storyCaptureCommands: CommandContribution['commands'] = {
  [VERB]: { timeoutMs: 120_000, derivedRefresh: 'if-content-changed', handle },
};
