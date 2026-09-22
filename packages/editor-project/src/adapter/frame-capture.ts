/**
 * What a WebGL frame capture IS — the reading `SystemAdapters`'s frame-capture
 * door answers with. The contract owns the shape; the instrument that records
 * it shadow-patches a live WebGL2 context and is the game runtime's
 * (`@vgai/game-runtime/dev/webgl-frame-capture`).
 */

/** The five WebGL2 draw entry points this instrument wraps. */
export type FrameCaptureEntryPoint =
  | 'drawArrays'
  | 'drawElements'
  | 'drawArraysInstanced'
  | 'drawElementsInstanced'
  | 'drawRangeElements';

/** Per-draw attribution supplied by {@link WebGLFrameCapture.annotateNextDraw}
 *  (the render adapter derives it from the three.js object about to draw). */
export interface DrawAnnotation {
  object: { name: string; type: string; entityId?: string };
  geometry: { type: string; name: string; attributes: string[]; indexed: boolean };
  material: { type: string; name: string };
}

/** Where a draw rendered: the default framebuffer (canvas) or a bound FBO. */
export type DrawTarget =
  | { kind: 'canvas' }
  | {
      kind: 'framebuffer';
      /** Color-attachment width, or `null` when not cheaply queryable
       *  (texture attachment — raw WebGL2 has no size query). */
      width: number | null;
      height: number | null;
      /** Capture-local identity tag (`framebuffer#N`), not a GL debug name. */
      label: string | null;
    };

export interface FrameCaptureDrawCall {
  readonly index: number;
  readonly entryPoint: FrameCaptureEntryPoint;
  /** Decoded primitive mode, e.g. `'TRIANGLES'`, `'LINES'` (raw enum when
   *  unrecognised). */
  readonly mode: string;
  /** Vertex/index count passed to the draw. */
  readonly count: number;
  /** Instance count for the instanced entry points, else `null` (not 0 —
   *  a non-instanced draw has no instance count to report). */
  readonly instanceCount: number | null;
  /** Capture-local program identity (`program#N`), or `null` when no program
   *  was bound via `useProgram`. */
  readonly programLabel: string | null;
  readonly target: DrawTarget;
  /** Shadow-tracked viewport `[x, y, w, h]` at draw time. */
  readonly viewport: readonly [number, number, number, number];
  readonly state: {
    readonly blend: boolean;
    readonly depthTest: boolean;
    readonly depthWrite: boolean;
    readonly cull: 'front' | 'back' | 'none';
    readonly scissor: boolean;
  };
  /** The annotation this draw consumed, or `null` when none was pending
   *  (unattributed — e.g. a shadow/composer pass draw). */
  readonly annotation: DrawAnnotation | null;
}

export interface FrameCapture {
  readonly id: number;
  /** Injected capture timestamp (ms) — see `createWebGLFrameCapture` options. */
  readonly capturedAt: number;
  readonly drawCalls: readonly FrameCaptureDrawCall[];
  readonly totals: {
    /** Draws RECORDED (excludes any dropped past the cap). */
    readonly drawCalls: number;
    /** Recorded draws with `annotation: null`. */
    readonly unattributed: number;
    /** Draws dropped because the cap was hit (0 when nothing was dropped). */
    readonly truncated: number;
  };
  readonly notes: readonly string[];
}
