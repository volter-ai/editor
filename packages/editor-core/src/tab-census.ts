/**
 * THE TAB RESOURCE CENSUS, page side — what this tab is holding, sampled
 * cheaply and handed to the heartbeat worker to ride out on the next beat.
 *
 * WHY (measured 2026-08-10): a game tab's Chrome renderer process was killed
 * repeatedly — WS close code 1006, no goodbye — deterministically on one user
 * flow, with a 3840x2080 WebGL world and an HDR bloom chain resident and
 * painting. JS heap stayed flat at ~190 MB the whole time, so the kill was
 * GPU/compositor-side, at a per-process ceiling Chrome neither documents nor
 * announces. The tab-presence system recovered perfectly and recorded NOTHING
 * about why. This is the "why".
 *
 * The failure class is agent-native: an agent authors lush effects with zero
 * cost feedback, because the quality loop grades looks and never cost.
 *
 * IT ALSO CARRIES THE BLENDER BLOCK. The Blender worker's call times and this
 * thread's long-task stalls (`blender-tab-metrics.ts`) ride the same sample,
 * because the beat is the one channel that still moves while the page or the
 * worker is blocked — which is exactly when those numbers are the whole story.
 * Absent, not zeroed, in a tab with no Blender session.
 *
 * MEASUREMENT ONLY — nothing here enforces a budget. Budgets are a later
 * decision, made from real profiles rather than from a guess about them.
 *
 * WHAT IT COSTS. One sample every five seconds on the main thread, skipped
 * entirely while the tab is hidden: a `querySelectorAll('canvas')`, two
 * property reads, a scan of the bounded Resource Timing buffer, and — only
 * when a game is actually mounted — the render-debug adapter's existing
 * memory snapshot, which the Profiler's Memory view already polls five times
 * as often. Never per frame.
 *
 * WHAT IT DOES NOT DO. It adds no global, no new endpoint, and no second way
 * to reach a renderer: the renderer counts come from `RenderDebugAdapter`
 * (`authoring/active-systems.ts`), the one seam a mounted game already
 * registers, and they are ABSENT — not zero — when nothing has registered one.
 * A zero would read as "no textures", which is a different claim from "nobody
 * measured".
 */

import { PROJECT_MOUNT_QUERY } from '@volter/editor-sdk/session/project-module-url';
import type { BlenderTabMetrics, TabCensus } from '@volter/editor-sdk/tab-census';
import { getActiveRenderDebug } from './authoring/active-systems';
import { blenderTabMetrics } from './blender-tab-metrics';
import { isJsHeapReading, type JsHeapReading, readJsHeap } from '@volter/editor-sdk/kit/js-heap';

/** How often the page samples itself. Slow on purpose — see the header. */
export const TAB_CENSUS_INTERVAL_MS = 5_000;

/** Bytes a canvas backing store holds per pixel (RGBA8). */
const CANVAS_BYTES_PER_PIXEL = 4;

const BYTES_PER_MB = 1024 * 1024;

/**
 * One resource profile — THIS module is its producer, and `@volter/editor-sdk/tab-census`
 * is where the shape is declared for every unit that speaks it (the node server
 * that files it, the SDK status response, the journal line that prints it).
 * Re-exported here because this file's own callers look for it here.
 */
export type { TabCensus };

/** The three readings a sample is made of, injected so the sampler is pure. */
export interface TabCensusSources {
  /** Feature-detected JS heap (`readJsHeap`), or its unavailable-reason. */
  heap(): JsHeapReading | { readonly unavailable: string };
  /** Distinct `?vgai-mount=<id>` generations in Resource Timing. */
  mountEpochs(): number;
  /** Every canvas in the document, in BACKING-BUFFER pixels (not CSS px). */
  canvases(): readonly { readonly width: number; readonly height: number }[];
  /** Renderer resource counts, or null when no render-debug adapter is up. */
  rendererCounts(): {
    readonly geometries: number;
    readonly textures: number;
    readonly programs: number | null;
  } | null;
  /** The Blender worker's call times and the main thread's stalls, or null when
   *  this tab has no Blender session (`blender-tab-metrics.ts`). Optional so a
   *  caller measuring only the resource half omits it and gets no block, rather
   *  than having to fabricate one. */
  blender?(): BlenderTabMetrics | null;
}

/** Two decimals of an MB — enough to see a 4K framebuffer, short enough to read. */
function mb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 100) / 100;
}

/**
 * Take one census. PURE: everything it reads comes from `sources`, so the test
 * drives the absent-heap, absent-adapter and populated branches without a
 * browser.
 */
export function sampleTabCensus(sources: TabCensusSources): TabCensus {
  const heap = sources.heap();
  const canvases = sources.canvases();
  const counts = sources.rendererCounts();
  const blender = sources.blender?.() ?? null;
  let canvasBytes = 0;
  for (const canvas of canvases) {
    canvasBytes += canvas.width * canvas.height * CANVAS_BYTES_PER_PIXEL;
  }
  return {
    heapUsedMB: isJsHeapReading(heap) ? mb(heap.usedBytes) : null,
    heapLimitMB: isJsHeapReading(heap) && heap.limitBytes !== null ? mb(heap.limitBytes) : null,
    mountEpochs: sources.mountEpochs(),
    canvases: canvases.length,
    canvasMB: mb(canvasBytes),
    ...(blender === null ? {} : { blender }),
    ...(counts === null
      ? {}
      : {
          textures: counts.textures,
          geometries: counts.geometries,
          // `renderer.info.programs` is populated only after a first render,
          // and a count nobody could read stays absent rather than becoming 0.
          ...(counts.programs === null ? {} : { programs: counts.programs }),
        }),
  };
}

/**
 * Count the project module generations this document has fetched.
 *
 * Resource Timing is the browser-visible population we can measure without
 * instrumenting project modules or pretending the ES-module registry exposes
 * an enumeration API. The entries live for the document lifetime (the same
 * lifetime as its module registry), and the project mount split watch raises
 * the resource buffer before imports begin. A reload resets both populations.
 */
export function countProjectMountEpochs(resources: readonly { readonly name: string }[]): number {
  const epochs = new Set<string>();
  for (const resource of resources) {
    try {
      const epoch = new URL(resource.name, 'http://vgai.invalid').searchParams.get(
        PROJECT_MOUNT_QUERY,
      );
      if (epoch !== null && epoch.length > 0) epochs.add(epoch);
    } catch {
      // Resource Timing normally supplies absolute URLs. A malformed entry is
      // not evidence of a mount and must not sink the rest of the census.
    }
  }
  return epochs.size;
}

/** The real readings: this document, this browser, whatever game is mounted. */
export function documentCensusSources(): TabCensusSources {
  return {
    heap: () => readJsHeap(),
    mountEpochs: () => countProjectMountEpochs(performance.getEntriesByType('resource')),
    canvases: () => [...document.querySelectorAll('canvas')],
    rendererCounts: () => getActiveRenderDebug()?.memorySnapshot?.().counts ?? null,
    blender: () => blenderTabMetrics(),
  };
}

let latest: TabCensus | null = null;

/** The newest census this page took, for the stats overlay to print. Null
 *  until the first sample (and while the tab has only ever been hidden). */
export function latestTabCensus(): TabCensus | null {
  return latest;
}

export interface TabCensusLoopOptions {
  /** Hand the profile to the heartbeat worker (`editor-presence.ts`). */
  report(census: TabCensus): void;
  sources?: TabCensusSources;
  intervalMs?: number;
  /** True while the tab is backgrounded — a hidden tab is not sampled. */
  hidden?(): boolean;
}

/**
 * Start sampling. Returns the stop function.
 *
 * A HIDDEN tab is skipped rather than throttled: it is painting nothing, so a
 * sample would only re-report the moment it was backgrounded. Skipping is
 * SAFE — and only safe — because the worker carries each profile on one beat
 * and then drops it, so a tab that stops sampling stops sending and its
 * profile's reported age climbs honestly. (When the worker echoed its cache
 * instead, this skip is precisely what turned into the lie: a background tab
 * killed under memory pressure — a mainline path for this feature — reported
 * a half-second-old profile that was half an hour old.)
 */
export function startTabCensus(options: TabCensusLoopOptions): () => void {
  const sources = options.sources ?? documentCensusSources();
  const hidden = options.hidden ?? (() => document.visibilityState === 'hidden');
  const tick = (): void => {
    if (hidden()) return;
    const census = sampleTabCensus(sources);
    latest = census;
    options.report(census);
  };
  tick();
  const timer = setInterval(tick, options.intervalMs ?? TAB_CENSUS_INTERVAL_MS);
  return () => clearInterval(timer);
}
