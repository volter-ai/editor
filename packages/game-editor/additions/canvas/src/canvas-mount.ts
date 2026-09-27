/**
 * The standalone boot's `canvas` root mount: a `@pixi/react` `<Application>` with every `pixi.js`
 * class registered first, as the editor's own canvas mount registers them (so a node the editor
 * created, a TilingSprite or a BitmapText, mounts here too). Only a project with a `canvas` root
 * carries this file and the two packages; `main.ts` reaches it through the manifest's generated
 * module, so a game without a 2D scene imports no Pixi at all.
 */

import { Application, extend } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { type ComponentType, createElement } from 'react';
import { createRoot } from 'react-dom/client';

extend(PIXI as unknown as Parameters<typeof extend>[0]);

export interface CanvasMountOptions {
  /** The bottom world clears opaque; a world stacked above it clears transparent. */
  readonly bottom: boolean;
  /** Pixi's own hit test for interactive objects, handed to the boot's input routing. */
  readonly onHitTest: (canvas: HTMLCanvasElement, hit: (x: number, y: number) => boolean) => void;
}

export function mountCanvasRoot(layer: HTMLElement, Entry: ComponentType, options: CanvasMountOptions): void {
  createRoot(layer).render(
    createElement(
      Application,
      {
        resizeTo: layer,
        antialias: true,
        resolution: globalThis.devicePixelRatio ?? 1,
        autoDensity: true,
        backgroundAlpha: options.bottom ? 1 : 0,
        onInit: (app) => {
          // Pixi points its boundary at the last rendered scene inside its own pointer handlers.
          options.onHitTest(app.canvas, (x, y) => {
            const rendered = app.renderer.lastObjectRendered;
            if (!rendered) return false;
            app.renderer.events.rootBoundary.rootTarget = rendered;
            return app.renderer.events.rootBoundary.hitTest(x, y) !== null;
          });
        },
      },
      createElement(Entry),
    ),
  );
}
