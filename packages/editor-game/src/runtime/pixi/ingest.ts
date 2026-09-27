import type { VisibleCaptureWindow } from '@volter/threejs-runtime/adapter/ingest/visible-capture-window';
import {
  type CapturedRuntime2D,
  installSceneCapture2D,
  type SceneCapture2DHandle,
} from './scene-capture';

/** A registered unmodified PixiJS game (the Pixi analog of `IngestGame`). */
export interface IngestGame2D {
  id: string;
  name: string;
  description: string;
  /** Import + run the unmodified game module in the host's own realm. */
  load: () => Promise<unknown>;
  /** How long to wait for the game's first captured frame before failing. */
  captureTimeoutMs?: number;
}

/**
 * The game's own modules failed to load or run — a DIFFERENT defect from
 * "loaded, but the host's pixi never saw a frame", and named so a caller can
 * tell them apart.
 *
 * Both used to arrive as a bare `Error`, so `mount-canvas-ingest-root.ts`'s
 * one catch reported a module that 404'd, threw, or failed to transform in
 * the capture trap's words — "the host's pixi captured no frame ... or it
 * bundles its own (un-shared) copy of pixi.js". That sentence sends the
 * reader to the wrong file: it describes a module-identity problem, and the
 * measured cause was a JSX-bearing `.js` module the packaged host had no
 * transform for.
 *
 * Classified by `name` ({@link INGEST_GAME_2D_LOAD_ERROR_NAME}) rather than
 * `instanceof` — under the packaged runtime the editor shell and the project
 * graph can hold different instances of a module, and this whole lane exists
 * because of that; a discriminator that silently flips when the class object
 * differs is the wrong tool for saying which failure happened.
 */
export const INGEST_GAME_2D_LOAD_ERROR_NAME = 'IngestGame2DLoadError';

export class IngestGame2DLoadError extends Error {
  constructor(gameId: string, cause: unknown) {
    super(`pixi ingest: game "${gameId}" failed to load: ${cause}`, { cause });
    this.name = INGEST_GAME_2D_LOAD_ERROR_NAME;
  }
}

export interface IngestMount2D {
  /** The captured live stage Container. */
  stage: unknown;
  capture: SceneCapture2DHandle;
  setPaused(paused: boolean): void;
  dispose(): void;
}

/**
 * Mount an UNMODIFIED PixiJS game via the shared-instance capture path — the 2D
 * analog of `mountIngestGame`. Installs the render trap on the host's pixi
 * instance, runs the game's `load()`, waits for the game to render its first
 * frame (capturing its live stage), and exposes loop gating + cleanup. A game
 * whose pixi the trap cannot reach never captures, and the mount FAILS by name.
 *
 * `onWait` is the three lane's own seam (`ingest-root-adapter.ts` passes
 * `setCaptureWait`): the capture window PARKS while the tab is hidden, and a
 * parked wait is otherwise indistinguishable from a hung mount at every door.
 * Threading it here is what lets `vgai status` say "waiting for the first
 * visible frame — the tab is hidden" over a canvas ingest too.
 */
export async function mountIngestGame2D(
  pixiNamespace: unknown,
  game: IngestGame2D,
  opts: {
    captureTimeoutMs?: number;
    onWait?: (wait: VisibleCaptureWindow | null) => void;
    acceptCapture?: (runtime: CapturedRuntime2D) => boolean;
    /**
     * Called after the entry has run, before spending the Pixi capture budget.
     * A canvas host with other structural adapters can answer true once one of
     * those runtimes is ready; `null` then means "dispatch that runtime" rather
     * than "Pixi failed".
     */
    preferStructuralRuntime?: () => boolean | Promise<boolean>;
  } = {},
): Promise<IngestMount2D | null> {
  const capture = installSceneCapture2D(pixiNamespace, {
    ...(opts.acceptCapture ? { accept: opts.acceptCapture } : {}),
  });
  try {
    await game.load();
    if (await opts.preferStructuralRuntime?.()) {
      capture.uninstall();
      return null;
    }
  } catch (err) {
    capture.uninstall();
    throw new IngestGame2DLoadError(game.id, err);
  }

  const timeout = opts.captureTimeoutMs ?? game.captureTimeoutMs ?? 8000;
  try {
    const rt = await capture.waitForCapture({
      timeoutMs: timeout,
      ...(opts.onWait ? { onWait: opts.onWait } : {}),
    });
    return {
      stage: rt.stage,
      capture,
      setPaused: (p) => capture.setPaused(p),
      dispose: () => capture.uninstall(),
    };
  } catch (err) {
    capture.uninstall();
    throw new Error(
      `pixi ingest: game "${game.id}" rendered no capturable frame within ${timeout}ms: ${err}`,
    );
  }
}
