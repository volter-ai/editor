/**
 * The reusable renderer lane for interactive Object3D document stages.
 *
 * A document owns its source and per-pane state; this pool owns only the GPU
 * attachment. Hidden panes return their lease, so open tabs do not each pin a
 * WebGL context. One idle entry keeps the expensive driver/program setup warm
 * for the next revealed pane. Active panes receive exclusive leases and scale
 * with the number of panes that are actually visible.
 */

import { markHostRenderer } from '@volter/editor-threejs/viewport/renderer-ownership';
import * as THREE from 'three';

const IDLE_CAPACITY = 1;

interface InteractiveRendererEntry {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  leased: boolean;
  lost: boolean;
  onContextLost: (() => void) | null;
}

const entries: InteractiveRendererEntry[] = [];

export interface InteractiveViewportRendererLease {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  release(): void;
}

function disposeEntry(entry: InteractiveRendererEntry): void {
  const index = entries.indexOf(entry);
  if (index >= 0) entries.splice(index, 1);
  entry.renderer.dispose();
  entry.renderer.forceContextLoss();
  entry.canvas.remove();
}

function createEntry(width: number, height: number): InteractiveRendererEntry {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const entry: InteractiveRendererEntry = {
    canvas,
    renderer: markHostRenderer(new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })),
    leased: true,
    lost: false,
    onContextLost: null,
  };
  canvas.addEventListener('webglcontextlost', () => {
    entry.lost = true;
    entry.onContextLost?.();
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    if (!entry.leased) disposeEntry(entry);
  });
  entries.push(entry);
  return entry;
}

/** Reset every mutable renderer setting a document is allowed to change. */
function resetRenderer(entry: InteractiveRendererEntry): void {
  const { renderer } = entry;
  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, Math.max(1, entry.canvas.width), Math.max(1, entry.canvas.height));
  renderer.setScissor(0, 0, Math.max(1, entry.canvas.width), Math.max(1, entry.canvas.height));
  renderer.autoClear = true;
  renderer.autoClearColor = true;
  renderer.autoClearDepth = true;
  renderer.autoClearStencil = true;
  renderer.sortObjects = true;
  renderer.localClippingEnabled = false;
  renderer.clippingPlanes = [];
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.autoUpdate = true;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = false;
  renderer.setAnimationLoop(null);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.info.reset();
}

/** Acquire one exclusive interactive renderer. */
export function acquireInteractiveViewportRenderer(
  width: number,
  height: number,
  onContextLost?: () => void,
): InteractiveViewportRendererLease {
  let entry = entries.find((candidate) => !candidate.leased && !candidate.lost);
  if (!entry) entry = createEntry(width, height);
  entry.leased = true;
  entry.onContextLost = onContextLost ?? null;
  const held = entry;
  let released = false;
  return {
    canvas: held.canvas,
    renderer: held.renderer,
    release(): void {
      if (released) return;
      released = true;
      held.leased = false;
      held.onContextLost = null;
      held.canvas.remove();
      if (held.lost) {
        disposeEntry(held);
        return;
      }
      resetRenderer(held);
      const idle = entries.filter((candidate) => !candidate.leased && !candidate.lost);
      for (const overflow of idle.slice(IDLE_CAPACITY)) disposeEntry(overflow);
    },
  };
}

/** Diagnostic readback used by live acceptance checks. */
export function interactiveViewportRendererCounts(): {
  readonly active: number;
  readonly idle: number;
} {
  return {
    active: entries.filter((entry) => entry.leased && !entry.lost).length,
    idle: entries.filter((entry) => !entry.leased && !entry.lost).length,
  };
}
