/**
 * The camera half of Play's immersive entry (`host.viewport.transition`): the viewport flies from
 * its preview pose to the authored game camera while the chrome dissolves, converges on the
 * game's live camera once it boots, and restores the preview pose when Play ends. The kit's
 * transition owns the phases and the chrome; the Three integration registers the flight.
 */
import type { EditorHostLiveTransition } from '../host';

/** The game's live render camera, handed over when its runtime is ready. */
export type LiveCameraLookup = NonNullable<Parameters<EditorHostLiveTransition['ready']>[0]>;

export interface PlayCameraFlight {
  /** Resolve the authored camera and start flying; `false` when there is nothing to fly to (no
   *  viewport, no authored camera). `onLanded` runs once, when the flight reaches its target. */
  begin(onLanded: () => void): boolean;
  /** Converge on the game's live camera from now on. */
  track(liveCamera: LiveCameraLookup): void;
  /** The game is on screen: stop driving the camera and leave orbit usable at the landed pose. */
  settle(): void;
  /** Play ended: restore the pose the viewport had before the flight. */
  end(): void;
}

let registered: PlayCameraFlight | null = null;

export function registerPlayCameraFlight(flight: PlayCameraFlight): () => void {
  registered = flight;
  return () => {
    if (registered === flight) registered = null;
  };
}

export function playCameraFlight(): PlayCameraFlight | null {
  return registered;
}
