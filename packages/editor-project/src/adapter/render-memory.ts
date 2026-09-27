/**
 * What a render-memory reading IS — the shape `SystemAdapters`'s memory door
 * answers with. The contract owns the shape; the measurement that fills it
 * walks a live three.js scene and is the game runtime's
 * (`@volter/editor-game/runtime/dev/render-memory`).
 */

export interface RenderMemoryEntry {
  readonly name: string;
  readonly bytes: number;
}

export interface RenderMemoryUnestimated {
  readonly name: string;
  readonly reason: string;
}

export interface RenderMemorySnapshot {
  readonly counts: {
    readonly geometries: number;
    readonly textures: number;
    /** Compiled program count, or `null` when the renderer doesn't expose it
     *  (`renderer.info.programs` is populated only after the first render). */
    readonly programs: number | null;
  };
  /** Sum of every ESTIMABLE texture (nulls excluded — they are in
   *  `unestimated`). */
  readonly estimatedTextureBytes: number;
  /** Exact sum of geometry attribute + index buffers. */
  readonly estimatedGeometryBytes: number;
  readonly topTextures: readonly RenderMemoryEntry[];
  readonly topGeometries: readonly RenderMemoryEntry[];
  readonly unestimated: readonly RenderMemoryUnestimated[];
}
