/**
 * `camera --position x,y,z --target x,y,z [--fov n]` — POSE THE CURRENT
 * DOCUMENT'S VIEWPORT CAMERA from the shell.
 *
 * Why this exists (measured 2026-10, an agent building an obby): it looked for
 * `setCamera` on the eval façade, found nothing, and improvised a pose out of
 * `frame()` and `orbit()`. The public route was there all along — a presented
 * view's `viewport.camera` (`editor-view-presentation.ts`'s `applyPresentation`
 * → the document's `DocumentViewport.setCamera`) — but nothing named it. This
 * verb is that route, behind a name; it adds no second way to move a camera.
 *
 * THE NUMBERS ARE BLENDER'S: metres, Z up, exactly what `bpy` reports for
 * `object.location`, so a point read off the model can be typed back in. The
 * presented camera is in the STAGE's space, three.js's Y up — the Model root
 * carries the permutation (x, y, z) → (x, z, −y) as an exact matrix
 * (`blender-runtime-view.ts`), and `blender-runtime-host.ts` records what
 * happened when raw Blender numbers were handed to the presenter as if they
 * were stage space: a camera under the floor. So the conversion happens here,
 * once, and the answer prints both spellings.
 */
import { connect } from '@volter/live';
import type { EditorCameraState } from '@volter/sdk';

export const CAMERA_USAGE = 'camera --position x,y,z --target x,y,z [--fov <degrees>]    # Blender metres, Z up';

/** `parseArgs` option declarations for {@link camera}'s flags. */
export const CAMERA_OPTIONS = { position: { type: 'string' }, target: { type: 'string' }, fov: { type: 'string' } } as const;

type Triple = readonly [number, number, number];

function triple(flag: string, raw: string | undefined): Triple {
  if (raw === undefined) throw new Error(`Usage: cyclotron ${CAMERA_USAGE}\n--${flag} is required.`);
  const parts = raw.split(',').map(part => Number(part.trim()));
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part)))
    throw new Error(`--${flag} takes three comma-separated numbers in Blender metres, Z up (e.g. --${flag} 6,-8,4); got ${raw}.`);
  return parts as unknown as Triple;
}

/** Blender (x, y, z), Z up → the stage's (x, z, −y), Y up. */
const toStage = ([x, y, z]: Triple) => ({ x, y: z, z: y === 0 ? 0 : -y });
/** The stage's (x, y, z), Y up → Blender's (x, −z, y), Z up. */
const toBlender = ({ x, y, z }: { x: number; y: number; z: number }) => [x, z === 0 ? 0 : -z, y];

export async function camera(options: { position?: string | undefined; target?: string | undefined; fov?: string | undefined }): Promise<void> {
  const position = triple('position', options.position);
  const target = triple('target', options.target);
  let fov: number | undefined;
  if (options.fov !== undefined) {
    fov = Number(options.fov);
    // The stage ignores a field of view outside (0, 180) silently
    // (`Object3DDocumentSession.setCameraPose`); refuse it by name instead.
    if (!Number.isFinite(fov) || fov <= 0 || fov >= 180) throw new Error(`--fov is the vertical field of view in degrees, between 0 and 180; got ${options.fov}.`);
  }
  if (position.every((value, axis) => value === target[axis])) throw new Error('--position and --target are the same point; the camera needs a direction to look.');
  const pose: EditorCameraState = { position: toStage(position), target: toStage(target), ...(fov === undefined ? {} : { fov }) };
  const live = await connect();
  const presented = await live.editor.present({ version: 1, viewport: { camera: pose } });
  // A view the document cannot take is a WARNING in the presenter's answer, never a throw
  // (`applyPresentation`), so the verb that exists only to move the camera refuses here.
  if (presented.warnings.length > 0) throw new Error(`The camera did not move: ${presented.warnings.join(' ')}`);
  const now = (await live.editor.currentView()).viewport?.camera;
  console.log(JSON.stringify({
    blender: { position, target, ...(fov === undefined ? {} : { fov }) },
    stage: pose,
    ...(now !== undefined && typeof now !== 'string' ? { now: { position: toBlender(now.position), target: toBlender(now.target), ...(now.fov === undefined ? {} : { fov: now.fov }) } } : {}),
    url: presented.url,
  }, null, 2));
}
