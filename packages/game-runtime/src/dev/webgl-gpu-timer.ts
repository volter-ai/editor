interface DisjointTimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** Non-blocking WebGL2 timer query; results are consumed on later frames. */
export function createWebGLGpuTimer(context: WebGLRenderingContext | WebGL2RenderingContext) {
  const gl = context as WebGL2RenderingContext;
  const extension = gl.getExtension(
    'EXT_disjoint_timer_query_webgl2',
  ) as DisjointTimerQueryExtension | null;
  const supported = extension !== null && typeof gl.createQuery === 'function';
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let latestMs: number | null = null;

  return {
    begin() {
      if (!supported || active) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(extension!.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!supported || !active) return;
      gl.endQuery(extension!.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll(): number | null {
      if (!supported) return null;
      if (gl.getParameter(extension!.GPU_DISJOINT_EXT)) {
        for (const query of pending.splice(0)) gl.deleteQuery(query);
        return null;
      }
      while (pending.length > 0) {
        const query = pending[0]!;
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        latestMs = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1_000_000;
        gl.deleteQuery(query);
      }
      return latestMs;
    },
    dispose() {
      if (active) {
        gl.endQuery(extension!.TIME_ELAPSED_EXT);
        gl.deleteQuery(active);
        active = null;
      }
      for (const query of pending.splice(0)) gl.deleteQuery(query);
    },
  };
}
