/**
 * First-party WebGL2 single-frame draw-call capture (W4b, F11 frame debugger).
 *
 * WHY FIRST-PARTY, NOT spectorjs (recorded per the "use libraries directly, no
 * wrappers" rule): the capture seam we need is the WebGL2 context this engine
 * ALREADY owns end-to-end (`renderer.getContext()` in
 * `world3d-react/r3f-root-factory.tsx`). spectorjs is absent from node_modules, and its
 * actual value is a bundled inspector UI we would discard — adopting it imports
 * ~2MB of library to keep ~10% of it, and it wraps the context with its own
 * global patching model rather than the instance-shadow-and-restore discipline
 * the rest of dev/ uses (see `webgl-gpu-timer.ts`, the raw-context precedent
 * this mirrors: instance shadowing, restore-in-finally, mock-GL unit test). So
 * we instrument the real context directly, at the one seam we control.
 *
 * DISCIPLINE (mirrors webgl-gpu-timer.ts):
 *  - Patching happens ONLY inside `beginPass()` and ONLY while `armed`. Every
 *    patch is an OWN-property shadow on the context instance; the WebGL2
 *    prototype is NEVER touched. `endPass()` restores every original in a
 *    `finally` (own props reassigned, prototype-inherited methods `delete`d so
 *    the real method shows through again), so a throwing draw cannot leave the
 *    context wrapped.
 *  - HONESTY (adapters never fabricate): a value we cannot measure at this seam
 *    is recorded as `null` with the reason implied by the field, never zeroed
 *    or guessed. Program/framebuffer LABELS are capture-local identity tags
 *    (`program#N`), not the object's real GL debug name (raw WebGL2 exposes
 *    none). Framebuffer dimensions are only reported when cheaply knowable
 *    (renderbuffer color attachment); a texture-attachment FBO's size is not
 *    queryable in raw WebGL2, so it is `null`, not invented (see below —
 *    a documented deviation from the plan's non-nullable width/height).
 *  - Draw attribution is a single pending-annotation slot consumed by the NEXT
 *    draw and then cleared: a second draw with no fresh annotation records
 *    `annotation: null` (counted as unattributed), never the previous draw's.
 */

import type {
  DrawAnnotation,
  DrawTarget,
  FrameCapture,
  FrameCaptureDrawCall,
  FrameCaptureEntryPoint,
} from '@volter/editor-project/adapter/frame-capture';

export type {
  DrawAnnotation,
  DrawTarget,
  FrameCapture,
  FrameCaptureDrawCall,
  FrameCaptureEntryPoint,
} from '@volter/editor-project/adapter/frame-capture';

export interface WebGLFrameCaptureOptions {
  /** Injected clock for `capturedAt`; defaults to `Date.now`. Injectable so a
   *  test gets deterministic timestamps (mirrors the profiler stamping time
   *  through a single `now()` indirection rather than a module-level call). */
  now?: () => number;
  /** Hard cap on recorded draws (default 5000). Draws past it are dropped and
   *  counted in `totals.truncated`, with a note. */
  maxDrawCalls?: number;
}

export interface WebGLFrameCapture {
  /** Arm a single capture; the NEXT `beginPass()` patches the context. */
  arm(): void;
  readonly armed: boolean;
  /** If armed, shadow-patch the context. No-op otherwise (zero patching when
   *  not armed). Must be paired with `endPass()`. */
  beginPass(): void;
  /** Restore all patches (in `finally`) and, if a pass was patched, return the
   *  assembled {@link FrameCapture}. Returns `null` if `beginPass` did not
   *  patch (was not armed). One-shot: disarms after. */
  endPass(): FrameCapture | null;
  /** Set the annotation the next draw will consume (then cleared). */
  annotateNextDraw(annotation: DrawAnnotation): void;
}

const DEFAULT_MAX_DRAW_CALLS = 5000;

/** GL primitive-mode enum → name (decoded once, from the live context). */
function buildModeTable(gl: WebGL2RenderingContext): Map<number, string> {
  return new Map<number, string>([
    [gl.POINTS, 'POINTS'],
    [gl.LINES, 'LINES'],
    [gl.LINE_LOOP, 'LINE_LOOP'],
    [gl.LINE_STRIP, 'LINE_STRIP'],
    [gl.TRIANGLES, 'TRIANGLES'],
    [gl.TRIANGLE_STRIP, 'TRIANGLE_STRIP'],
    [gl.TRIANGLE_FAN, 'TRIANGLE_FAN'],
  ]);
}

export function createWebGLFrameCapture(
  gl: WebGL2RenderingContext,
  options: WebGLFrameCaptureOptions = {},
): WebGLFrameCapture {
  const nowFn = options.now ?? (() => Date.now());
  const maxDrawCalls = options.maxDrawCalls ?? DEFAULT_MAX_DRAW_CALLS;
  const modeTable = buildModeTable(gl);

  // Persistent identity maps (stable labels across passes).
  const programLabels = new Map<WebGLProgram, string>();
  const framebufferLabels = new Map<WebGLFramebuffer, string>();
  let nextProgramId = 0;
  let nextFramebufferId = 0;
  let captureId = 0;

  // Shadow-tracked GL state (updated by the wrapped setters during a pass).
  let currentProgram: WebGLProgram | null = null;
  let currentFramebuffer: WebGLFramebuffer | null = null;
  let currentViewport: [number, number, number, number] = [0, 0, 0, 0];

  // Per-pass accumulators.
  let armed = false;
  let patched = false;
  let drawCalls: FrameCaptureDrawCall[] = [];
  let truncated = 0;
  let notes: string[] = [];
  let pendingAnnotation: DrawAnnotation | null = null;

  // Saved originals for restore. Value is the original fn; a key present in
  // `wasOwn` means it was an own property (restore by assignment), otherwise
  // it was prototype-inherited (restore by delete).
  const originals = new Map<string, unknown>();
  const wasOwn = new Set<string>();

  function decodeMode(mode: number): string {
    return modeTable.get(mode) ?? `0x${mode.toString(16)}`;
  }

  function labelForProgram(program: WebGLProgram | null): string | null {
    if (!program) return null;
    let label = programLabels.get(program);
    if (label === undefined) {
      label = `program#${nextProgramId++}`;
      programLabels.set(program, label);
    }
    return label;
  }

  /** Best-effort color-attachment dimensions for a bound draw FBO. Only a
   *  RENDERBUFFER color attachment is cheaply queryable in raw WebGL2; a
   *  texture attachment is not, so this returns nulls (honest absence). All
   *  reads are guarded — a mock/foreign context returns nulls, never throws. */
  function measureFramebufferSize(): { width: number | null; height: number | null } {
    try {
      const type = gl.getFramebufferAttachmentParameter(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE,
      );
      if (type === gl.RENDERBUFFER) {
        const rb = gl.getFramebufferAttachmentParameter(
          gl.DRAW_FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME,
        ) as WebGLRenderbuffer | null;
        if (!rb) return { width: null, height: null };
        const prev = gl.getParameter(gl.RENDERBUFFER_BINDING) as WebGLRenderbuffer | null;
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        const width = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_WIDTH) as number;
        const height = gl.getRenderbufferParameter(
          gl.RENDERBUFFER,
          gl.RENDERBUFFER_HEIGHT,
        ) as number;
        gl.bindRenderbuffer(gl.RENDERBUFFER, prev);
        return { width, height };
      }
    } catch {
      // Foreign/mock context or an attachment we can't introspect — degrade
      // to unknown dimensions rather than throwing mid-capture.
    }
    return { width: null, height: null };
  }

  function currentTarget(): DrawTarget {
    if (!currentFramebuffer) return { kind: 'canvas' };
    let label = framebufferLabels.get(currentFramebuffer);
    if (label === undefined) {
      label = `framebuffer#${nextFramebufferId++}`;
      framebufferLabels.set(currentFramebuffer, label);
    }
    const { width, height } = measureFramebufferSize();
    return { kind: 'framebuffer', width, height, label };
  }

  function readCull(): 'front' | 'back' | 'none' {
    if (!gl.getParameter(gl.CULL_FACE)) return 'none';
    return gl.getParameter(gl.CULL_FACE_MODE) === gl.FRONT ? 'front' : 'back';
  }

  function recordDraw(
    entryPoint: FrameCaptureEntryPoint,
    mode: number,
    count: number,
    instanceCount: number | null,
  ): void {
    if (drawCalls.length >= maxDrawCalls) {
      truncated++;
      pendingAnnotation = null;
      return;
    }
    const annotation = pendingAnnotation;
    pendingAnnotation = null;
    drawCalls.push({
      index: drawCalls.length,
      entryPoint,
      mode: decodeMode(mode),
      count,
      instanceCount,
      programLabel: labelForProgram(currentProgram),
      target: currentTarget(),
      viewport: [...currentViewport] as [number, number, number, number],
      state: {
        blend: Boolean(gl.getParameter(gl.BLEND)),
        depthTest: Boolean(gl.getParameter(gl.DEPTH_TEST)),
        depthWrite: Boolean(gl.getParameter(gl.DEPTH_WRITEMASK)),
        cull: readCull(),
        scissor: Boolean(gl.getParameter(gl.SCISSOR_TEST)),
      },
      annotation: annotation ?? null,
    });
  }

  // Cast to an index signature to shadow methods without fighting the DOM lib
  // types on every wrapped name.
  const target = gl as unknown as Record<string, unknown>;

  function patch(name: string, wrapper: (original: (...a: unknown[]) => unknown) => unknown): void {
    const original = target[name] as (...a: unknown[]) => unknown;
    originals.set(name, original);
    if (Object.hasOwn(gl, name)) wasOwn.add(name);
    target[name] = wrapper(original.bind(gl));
  }

  function restoreAll(): void {
    for (const [name, original] of originals) {
      if (wasOwn.has(name)) target[name] = original;
      else delete target[name];
    }
    originals.clear();
    wasOwn.clear();
  }

  function installPatches(): void {
    // Seed shadow state from the live context so the first draw's viewport /
    // framebuffer / program reflect reality even before any setter fires.
    try {
      const vp = gl.getParameter(gl.VIEWPORT) as ArrayLike<number> | null;
      if (vp && vp.length >= 4) currentViewport = [vp[0]!, vp[1]!, vp[2]!, vp[3]!];
      currentFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      currentProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    } catch {
      // Mock context without full getParameter coverage — start from defaults.
    }

    patch('useProgram', (original) => (program: unknown) => {
      currentProgram = (program as WebGLProgram) ?? null;
      return original(program);
    });
    patch('bindFramebuffer', (original) => (bindTarget: unknown, framebuffer: unknown) => {
      // Track the DRAW framebuffer binding (FRAMEBUFFER and DRAW_FRAMEBUFFER
      // both affect it; READ_FRAMEBUFFER does not).
      if (bindTarget === gl.FRAMEBUFFER || bindTarget === gl.DRAW_FRAMEBUFFER) {
        currentFramebuffer = (framebuffer as WebGLFramebuffer) ?? null;
      }
      return original(bindTarget, framebuffer);
    });
    patch('viewport', (original) => (x: unknown, y: unknown, w: unknown, h: unknown) => {
      currentViewport = [x as number, y as number, w as number, h as number];
      return original(x, y, w, h);
    });

    patch('drawArrays', (original) => (mode: unknown, first: unknown, count: unknown) => {
      recordDraw('drawArrays', mode as number, count as number, null);
      return original(mode, first, count);
    });
    patch(
      'drawElements',
      (original) => (mode: unknown, count: unknown, type: unknown, offset: unknown) => {
        recordDraw('drawElements', mode as number, count as number, null);
        return original(mode, count, type, offset);
      },
    );
    patch(
      'drawArraysInstanced',
      (original) => (mode: unknown, first: unknown, count: unknown, instanceCount: unknown) => {
        recordDraw('drawArraysInstanced', mode as number, count as number, instanceCount as number);
        return original(mode, first, count, instanceCount);
      },
    );
    patch(
      'drawElementsInstanced',
      (original) =>
        (mode: unknown, count: unknown, type: unknown, offset: unknown, instanceCount: unknown) => {
          recordDraw(
            'drawElementsInstanced',
            mode as number,
            count as number,
            instanceCount as number,
          );
          return original(mode, count, type, offset, instanceCount);
        },
    );
    patch(
      'drawRangeElements',
      (original) =>
        (
          mode: unknown,
          start: unknown,
          end: unknown,
          count: unknown,
          type: unknown,
          offset: unknown,
        ) => {
          recordDraw('drawRangeElements', mode as number, count as number, null);
          return original(mode, start, end, count, type, offset);
        },
    );
  }

  return {
    arm() {
      armed = true;
    },
    get armed() {
      return armed;
    },
    beginPass() {
      if (!armed || patched) return;
      patched = true;
      drawCalls = [];
      truncated = 0;
      notes = [];
      pendingAnnotation = null;
      installPatches();
    },
    endPass(): FrameCapture | null {
      if (!patched) {
        armed = false;
        return null;
      }
      try {
        if (truncated > 0) {
          notes.push(
            `Draw list capped at ${maxDrawCalls}; ${truncated} later draw(s) were not recorded.`,
          );
        }
        const unattributed = drawCalls.reduce((n, d) => n + (d.annotation === null ? 1 : 0), 0);
        return {
          id: ++captureId,
          capturedAt: nowFn(),
          drawCalls: drawCalls.slice(),
          totals: { drawCalls: drawCalls.length, unattributed, truncated },
          notes: notes.slice(),
        };
      } finally {
        restoreAll();
        patched = false;
        armed = false;
        pendingAnnotation = null;
      }
    },
    annotateNextDraw(annotation: DrawAnnotation) {
      pendingAnnotation = annotation;
    },
  };
}
