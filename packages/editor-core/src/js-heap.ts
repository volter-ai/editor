/**
 * THE JS HEAP READING — the editor's one browser-side memory signal, read by
 * the tab census (`tab-census.ts`: the heartbeat's sample, the death line's
 * quote) and by the Frame debugger's tile (`@vgai/game`). A browser
 * property, not a scene property (M1 kept it out of the engine's
 * render-memory on purpose), and Chromium-only: feature-detected, with the
 * REASON returned when the global is absent — never a fabricated 0.
 */
export interface JsHeapReading {
  readonly usedBytes: number;
  readonly totalBytes: number;
  /**
   * `jsHeapSizeLimit` — the CEILING this renderer process may allocate to,
   * which is the only one of the three that says how close to a heap death
   * the tab is (`totalBytes` is merely what it has claimed so far). Null when
   * the browser exposes the other two and not this one; the tab census reads
   * it, and reads null as null.
   */
  readonly limitBytes: number | null;
}

export interface JsHeapUnavailable {
  /** The honest reason the reading is absent (printed to the user). */
  readonly unavailable: string;
}

/** True when the reading is present (vs. the unavailable-reason branch). */
export function isJsHeapReading(
  reading: JsHeapReading | JsHeapUnavailable,
): reading is JsHeapReading {
  return !('unavailable' in reading);
}

/**
 * Read the JS heap via the Chromium-only `performance.memory` global — the one
 * editor-side memory signal (M1 kept it OUT of the engine's render-memory on
 * purpose: it is a browser property, not a scene property). Feature-detected:
 * when the global is absent (Firefox/Safari, or a locked-down Chromium), the
 * REASON is returned so the tile prints it, never a fabricated 0. `perf` is
 * injectable so the test can drive both branches deterministically.
 */
export function readJsHeap(
  perf: Performance | undefined = globalThis.performance,
): JsHeapReading | JsHeapUnavailable {
  const memory = (
    perf as unknown as
      | {
          memory?: {
            usedJSHeapSize?: number;
            totalJSHeapSize?: number;
            jsHeapSizeLimit?: number;
          };
        }
      | undefined
  )?.memory;
  if (
    !memory ||
    typeof memory.usedJSHeapSize !== 'number' ||
    typeof memory.totalJSHeapSize !== 'number'
  ) {
    return {
      unavailable:
        'performance.memory is unavailable — it is a non-standard Chromium-only API, not exposed by this browser.',
    };
  }
  return {
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
    limitBytes: typeof memory.jsHeapSizeLimit === 'number' ? memory.jsHeapSizeLimit : null,
  };
}
