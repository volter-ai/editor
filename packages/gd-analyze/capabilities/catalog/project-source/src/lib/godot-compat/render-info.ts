/** Native per-frame render counters exposed by Godot 3 VisualServer. */

export interface GodotRenderFrameInfo {
  readonly calls: number;
  readonly triangles: number;
  readonly lines: number;
  readonly points: number;
}

export type GodotRenderInfoReader = () => GodotRenderFrameInfo;

const RENDER_INFO_VERTICES_IN_FRAME = 1;
const RENDER_INFO_DRAW_CALLS_IN_FRAME = 6;

function counter(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`VisualServer.get_render_info received an invalid native ${member} counter.`);
  }
  return value;
}

/**
 * Read only the counters Three's WebGLRenderer owns exactly. Its render-info record is reset and
 * accumulated by the native renderer for each frame: `calls` is the submitted draw-call count,
 * while triangles/lines/points are primitive counts and therefore reconstruct the submitted
 * vertex count without walking or guessing from the scene graph. Godot's object/material/shader/
 * surface and Canvas-only counters have no equivalent in that record and remain loud.
 */
export function godotVisualServerGetRenderInfo(
  read: GodotRenderInfoReader | undefined,
  requested: number,
): number {
  if (!Number.isSafeInteger(requested)) {
    throw new TypeError('VisualServer.get_render_info requires a RenderInfo integer.');
  }
  if (read === undefined) {
    throw new Error(
      'VisualServer.get_render_info requires the retained native Three WebGLRenderer counter owner.',
    );
  }
  const info = read();
  if (requested === RENDER_INFO_DRAW_CALLS_IN_FRAME) {
    return counter(info.calls, 'draw-call');
  }
  if (requested === RENDER_INFO_VERTICES_IN_FRAME) {
    return counter(info.triangles, 'triangle') * 3 +
      counter(info.lines, 'line') * 2 +
      counter(info.points, 'point');
  }
  throw new Error(
    `VisualServer.get_render_info(${String(requested)}) is unavailable: Three exposes no exact ` +
      'Godot object/material/shader/surface or Canvas-only frame counter for this RenderInfo value.',
  );
}
