/**
 * The two frame indirections `bridge-screenshot` and `bridge-recording-start`
 * need, copied out of the editor's `command-listener.ts` with them (WORK.md
 * §The workbench). Each is a lazy hop, not logic: the host keeps its own
 * copies for the verbs that stay there (the play boot and
 * `bridge-recording-export`, which still reads the shell store).
 */

import { getPlayRuntimeAccess } from '../play/play-mode';

/** Pixel recovery is a command-time concern. Keeping this indirection here
 * avoids loading the Pixi extraction stack merely because the control relay
 * is listening for a future screenshot/recording command. */
export async function captureLiveCanvasFrame(
  canvas: HTMLCanvasElement,
): Promise<CanvasImageSource | null> {
  const { liveCanvasFrame } = await import('@volter/editor-sdk/kit/live-canvas-frame');
  return liveCanvasFrame(canvas);
}

/** Both recording entry points keep a hidden native game's pixels current. */
export function refreshRecordingFrame(): void {
  const runtime = getPlayRuntimeAccess();
  if (runtime?.loop.liveness === 'loop-starved') runtime.runTicks?.(1, { render: 'last' });
}
