/**
 * The WebGL renderer the INSPECTOR-PREVIEW lane draws through — one per editor
 * session, not one per selection.
 *
 * Why this module exists (measured, 2026-08-07): every chromeless preview
 * (`components/InspectorObjectPreview.tsx` → `Object3DSnapshotDocument` →
 * `Object3DDocumentViewport`) used to construct its own
 * `THREE.WebGLRenderer` on mount, so SELECTING A THING built a whole GL stack.
 * A renderer's constructor is a long chain of synchronous driver round trips
 * (`WebGLCapabilities`/`getExtension`/`getParameter`), and its program cache
 * starts empty, so every selection also recompiled the subject's shaders and
 * re-baked the PMREM environment. A click profiled at ~1.9 s of frozen main
 * thread, 3.5 s of self time in `gl.getParameter` alone. Sharing one renderer
 * removes the construction entirely and lets the program cache and the IBL
 * bake survive across selections.
 *
 * OWNERSHIP — the one place it is stated:
 *  - This module OWNS every canvas, `WebGLRenderer` and baked
 *    {@link StandardEnvironment} it creates. Nothing else may dispose them.
 *  - SHARERS are lease holders: {@link acquireInspectorPreviewRenderer} hands
 *    out a lease, the holder mounts `lease.canvas` in its own container and
 *    draws through `lease.renderer` for as long as it is mounted.
 *  - The ONE teardown path a holder has is {@link InspectorPreviewLease.release}
 *    — it returns the renderer to the pool (or disposes it, if it was an
 *    overflow lease that the pool does not keep). A holder never calls
 *    `renderer.dispose()`, and never disposes `lease.environment()`, whose
 *    handle is deliberately non-owning.
 *  - Per-selection SCENE resources (the snapshot's skeletons, the dressing's
 *    lights/grid/backdrop) stay the holder's, exactly as before: three's
 *    program cache lives on the renderer and is not touched by disposing the
 *    materials that populated it.
 *
 * Capacity is deliberately small. The inspector shows ONE live preview at a
 * time by construction (`InspectionProjection.tsx` drops the disc to its glyph
 * while the preview panel is open), so a second entry is slack for a handover
 * frame, and anything beyond that is a transient renderer disposed on release
 * rather than a growing pool.
 */

import * as THREE from 'three';
import { createStandardEnvironment, type StandardEnvironment } from './environment';
import { markHostRenderer } from './renderer-ownership';

/** How many renderers the lane keeps alive between selections. */
const POOL_CAPACITY = 2;

interface PreviewRendererEntry {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  environment: StandardEnvironment | null;
  /** In the pool (kept between leases) rather than an overflow renderer. */
  pooled: boolean;
  leased: boolean;
  /** The GL context went away; the entry is dead and is never leased again. */
  lost: boolean;
}

const entries: PreviewRendererEntry[] = [];
const liveEntries = new Set<PreviewRendererEntry>();

export interface InspectorPreviewLease {
  /** The canvas to mount. It is the renderer's own `domElement`. */
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  /**
   * The lane's shared IBL bake, as a NON-OWNING handle: its `dispose()` is a
   * no-op, so the standard dressing (which disposes the environment it is
   * given) can take it under its usual contract without freeing a render
   * target the next selection needs.
   */
  environment(): StandardEnvironment;
  /** The one teardown path. Idempotent; unmounts the canvas. Discard after a
   * render exception: Three may have skipped its internal render-stack cleanup. */
  release(options?: { discard?: boolean }): void;
}

function createEntry(): PreviewRendererEntry {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  const renderer = markHostRenderer(
    new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }),
  );
  const entry: PreviewRendererEntry = {
    canvas,
    renderer,
    environment: null,
    pooled: false,
    leased: true,
    lost: false,
  };
  liveEntries.add(entry);
  // A lost context cannot be drawn through again, and three's renderer does not
  // rebuild itself. Drop the entry so the next acquisition builds a fresh one.
  canvas.addEventListener('webglcontextlost', () => {
    entry.lost = true;
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (!entry.leased) disposeEntry(entry);
  });
  return entry;
}

function disposeEntry(entry: PreviewRendererEntry): void {
  // forceContextLoss can deliver the loss event after an explicit discard.
  if (!liveEntries.delete(entry)) return;
  entry.environment?.dispose();
  entry.environment = null;
  entry.renderer.dispose();
  // `dispose()` frees GPU RESOURCES; it does not give the CONTEXT back. The
  // canvas holds it until garbage collection decides otherwise, and WebGL
  // contexts are a hard ~16-per-page budget the browser enforces by killing
  // the OLDEST — which is the main viewport, so the symptom is a white
  // viewport and "too many active WebGL contexts" far from the cause
  // (runhuman pass 104). Every other renderer owner in this editor already
  // pairs the two (`asset-preview.ts`, `components/world-root-stage.ts`); this
  // shared pool did not, and it backs both the Inspector preview and the
  // Object3D tool's viewport, so its transients leaked a context each.
  entry.renderer.forceContextLoss();
  entry.canvas.remove();
}

/** Diagnostic readback kept separate from the interactive-document pool. */
export function inspectorPreviewRendererCounts(): {
  readonly active: number;
  readonly idle: number;
} {
  return {
    active: [...liveEntries].filter((entry) => entry.leased && !entry.lost).length,
    idle: [...liveEntries].filter((entry) => !entry.leased && !entry.lost).length,
  };
}

/** Take the lane's renderer for one mounted preview. Never fails to a caller:
 *  when the pool is busy it hands back a transient renderer instead. */
export function acquireInspectorPreviewRenderer(): InspectorPreviewLease {
  let entry = entries.find((candidate) => !candidate.leased && !candidate.lost);
  if (!entry) {
    entry = createEntry();
    if (entries.length < POOL_CAPACITY) {
      entry.pooled = true;
      entries.push(entry);
    }
  }
  entry.leased = true;
  const held = entry;
  let released = false;
  return {
    canvas: held.canvas,
    renderer: held.renderer,
    environment(): StandardEnvironment {
      held.environment ??= createStandardEnvironment(held.renderer);
      const texture = held.environment.texture;
      return { texture, dispose: () => {} };
    },
    release(options): void {
      if (released) return;
      released = true;
      held.leased = false;
      held.canvas.remove();
      if (options?.discard) {
        held.lost = true;
        const index = entries.indexOf(held);
        if (index >= 0) entries.splice(index, 1);
      }
      if (!held.pooled || held.lost) {
        disposeEntry(held);
        return;
      }
      // Leave nothing of this subject on the surface: the canvas is re-mounted
      // for the NEXT subject and would otherwise show the last frame of the
      // previous one until its first draw lands.
      held.renderer.setScissorTest(false);
      held.renderer.autoClear = true;
      held.renderer.clear();
    },
  };
}
