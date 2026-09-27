/**
 * Standalone entry point: this game's own boot, in its own libraries.
 *
 * Every root `vgai.project.json` declares gets one layer in `#game-canvas`,
 * stacked by `zOrder`. A `three` root's entry default-exports a React Three
 * Fiber component and renders inside `<Canvas>`; a `dom` root's entry
 * default-exports a React component and renders with react-dom, in a layer
 * that lets pointer events fall through to the world except where its own
 * elements claim them (`pointer-events: auto`): a game's UI is that `dom` root.
 * A `canvas` root (2D game rendering) mounts through `src/canvas-mount.ts`, which
 * only a project with a canvas root carries, so a game without one imports no Pixi.
 * The editor mounts the same entries itself; nothing here runs inside it.
 *
 * `manifestEntryModules` is generated from the manifest's `entry` paths
 * (`manifest-entry-modules-plugin.ts`), so the manifest stays the one list of
 * roots while the bundler still sees static imports.
 */

import { Canvas } from '@react-three/fiber';
import { type ComponentType, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { manifestEntryModules, mountCanvasRoot } from 'virtual:vgai-manifest-entries';
import manifest from '../vgai.project.json';

interface DeclaredRoot {
  readonly id: string;
  readonly adapter: unknown;
  readonly entry?: string;
  readonly zOrder?: number;
}

function entryComponent(root: DeclaredRoot): ComponentType {
  const entryModule = root.entry ? manifestEntryModules[root.entry] : undefined;
  const Entry = (entryModule as { readonly default?: ComponentType } | undefined)?.default;
  if (!Entry) {
    throw new Error(
      `main.ts: root "${root.id}" entry "${root.entry ?? '(missing)'}" must default-export a component.`,
    );
  }
  return Entry;
}

document.title = manifest.name;
const container = document.getElementById('game-canvas') as HTMLElement;
const roots = [...(manifest.roots as readonly DeclaredRoot[])].sort(
  (a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0),
);
// The bottom world (the lowest `three` or `canvas` root) takes pointer input and clears opaque;
// a world stacked above it lets input fall through and clears transparent, as the editor stacks them.
const bottomWorld = roots.find((root) => root.adapter === 'three' || root.adapter === 'canvas');

// A `canvas` world above the bottom one claims the points where Pixi finds an interactive object (a
// sprite the player taps), as the editor's input router does: the press goes to that world alone, and every
// other point falls through to the world beneath. Topmost first.
const claims: { readonly zOrder: number; readonly canvas: HTMLCanvasElement; readonly hit: (x: number, y: number) => boolean }[] = [];
const forwarded = new WeakSet<Event>();
for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel'] as const) {
  container.addEventListener(
    type,
    (event) => {
      if (forwarded.has(event) || claims.length === 0) return;
      const box = container.getBoundingClientRect();
      const { clientX, clientY } = event as MouseEvent;
      const claim = claims.find((entry) => entry.hit(clientX - box.left, clientY - box.top));
      if (!claim) return;
      event.stopPropagation();
      // A copy that bubbles: Pixi hears pointermove on the document and pointerup on the window.
      const copy = new (event.constructor as typeof PointerEvent)(event.type, event as PointerEventInit);
      forwarded.add(copy);
      claim.canvas.dispatchEvent(copy);
    },
    true,
  );
}
for (const root of roots) {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  layer.style.zIndex = String(root.zOrder ?? 0);
  if (root.adapter !== 'dom' && root !== bottomWorld) layer.style.pointerEvents = 'none';
  container.appendChild(layer);
  const Entry = entryComponent(root);
  if (root.adapter === 'three') {
    // R3F's wrapper sets its own `pointer-events: auto`, so a world above the bottom one says `none`
    // itself; `alpha` clears the bottom world opaque, as the editor's renderer does.
    const bottom = root === bottomWorld;
    createRoot(layer).render(
      createElement(
        Canvas,
        { gl: { alpha: !bottom }, style: bottom ? undefined : { pointerEvents: 'none' } },
        createElement(Entry),
      ),
    );
  } else if (root.adapter === 'dom') {
    layer.style.pointerEvents = 'none';
    createRoot(layer).render(createElement(Entry));
  } else if (root.adapter === 'canvas') {
    if (!mountCanvasRoot) {
      throw new Error(`main.ts: root "${root.id}" is a canvas root, and this project carries no src/canvas-mount.ts.`);
    }
    if (root === bottomWorld) mountCanvasRoot(layer, Entry, { bottom: true, onHitTest: () => {} });
    else
      mountCanvasRoot(layer, Entry, {
        bottom: false,
        onHitTest: (canvas, hit) => {
          claims.push({ zOrder: root.zOrder ?? 0, canvas, hit });
          claims.sort((a, b) => b.zOrder - a.zOrder);
        },
      });
  } else {
    throw new Error(
      `main.ts: root "${root.id}" declares adapter ${JSON.stringify(root.adapter)}, which this boot does not mount.`,
    );
  }
}
