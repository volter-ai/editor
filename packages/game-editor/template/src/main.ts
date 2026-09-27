/**
 * Standalone entry point: this game's own boot, in its own libraries.
 *
 * Every root `vgai.project.json` declares gets one layer in `#game-canvas`,
 * stacked by `zOrder`. A `three` root's entry default-exports a React Three
 * Fiber component and renders inside `<Canvas>`; a `dom` root's entry
 * default-exports a React component and renders with react-dom, in a layer
 * that lets pointer events fall through to the world except where its own
 * elements claim them (`pointer-events: auto`); a `canvas` root's entry default-exports a
 * `@pixi/react` component and renders inside `<Application>`, with every `pixi.js` class
 * registered first, as the editor's own canvas mount registers them (so a node the editor created,
 * a TilingSprite or a BitmapText, mounts here too). The editor mounts the same entries itself;
 * nothing here runs inside it.
 *
 * `manifestEntryModules` is generated from the manifest's `entry` paths
 * (`manifest-entry-modules-plugin.ts`), so the manifest stays the one list of
 * roots while the bundler still sees static imports.
 */

import { Canvas } from '@react-three/fiber';
import { type ComponentType, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { manifestEntryModules } from 'virtual:vgai-manifest-entries';
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
    const [{ Application, extend }, PIXI] = await Promise.all([import('@pixi/react'), import('pixi.js')]);
    extend(PIXI as unknown as Parameters<typeof extend>[0]);
    createRoot(layer).render(
      createElement(
        Application,
        {
          resizeTo: layer,
          antialias: true,
          resolution: globalThis.devicePixelRatio ?? 1,
          autoDensity: true,
          backgroundAlpha: root === bottomWorld ? 1 : 0,
        },
        createElement(Entry),
      ),
    );
  } else {
    throw new Error(
      `main.ts: root "${root.id}" declares adapter ${JSON.stringify(root.adapter)}, which this boot does not mount.`,
    );
  }
}
