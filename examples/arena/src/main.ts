/**
 * Standalone entry point: this game's own boot, in its own libraries.
 *
 * Every root `vgai.project.json` declares gets one layer in `#game-canvas`,
 * stacked by `zOrder`. A `three` root's entry default-exports a React Three
 * Fiber component and renders inside `<Canvas>`; a `dom` root's entry
 * default-exports a React component and renders with react-dom, in a layer
 * that lets pointer events fall through to the world except where its own
 * elements claim them (`pointer-events: auto`). The editor mounts the same
 * entries itself; nothing here runs inside it.
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
for (const root of roots) {
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  layer.style.zIndex = String(root.zOrder ?? 0);
  container.appendChild(layer);
  const Entry = entryComponent(root);
  if (root.adapter === 'three') {
    createRoot(layer).render(createElement(Canvas, null, createElement(Entry)));
  } else if (root.adapter === 'dom') {
    layer.style.pointerEvents = 'none';
    createRoot(layer).render(createElement(Entry));
  } else {
    throw new Error(
      `main.ts: root "${root.id}" declares adapter ${JSON.stringify(root.adapter)}, which this boot does not mount.`,
    );
  }
}
