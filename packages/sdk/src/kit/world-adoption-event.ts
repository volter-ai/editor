/**
 * One world-adoption fact. `adopted` fires exactly once, when the trap commits
 * to a (scene, camera, renderer) triple; `alternate` fires for each DISTINCT
 * triple seen afterwards, up to the capture trap's `MAX_RECORDED_ALTERNATES`.
 */
export type WorldAdoptionEvent =
  | {
      readonly phase: 'adopted';
      /** `declared` = the contract named this scene; `measured` = first render won. */
      readonly source: 'declared' | 'measured';
      readonly sceneId: string;
      readonly cameraId: string;
    }
  | {
      readonly phase: 'alternate';
      readonly sceneId: string;
      readonly cameraId: string;
      /** `false` ⇒ a SECOND renderer is drawing, which is the stronger signal. */
      readonly sameRenderer: boolean;
      /** Draws observed when this alternate first appeared — how far past the
       *  adoption it is, without a wall clock. */
      readonly drawCount: number;
    };
