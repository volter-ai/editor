/**
 * @godot-class Control
 * @role PROTOCOL
 *
 * The page's Controls (docs/GODOT.md "UI is React DOM"). A scene renders each Control as a React
 * DOM element and sends them through the game's `tunnel-rat` tunnel (`src/ui.tsx`); the game's
 * `dom` root renders them over the world, laid out at the project's 2D size and scaled to the page
 * as Godot stretches its 2D (`GodotStretch`, `window.ts`).
 */

import { type CSSProperties, createElement, type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { godot_window_stretch } from './window';

/**
 * The props an instancing scene hands a scene rooted in a Control: its name, its style where the
 * instance places it (a container's child) or overrides it, and its children.
 */
export interface GodotControlRootProps {
  readonly 'data-name'?: string;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}

/**
 * The page's overlay for its Controls: laid out at the size the project lays its 2D out at and
 * scaled to the size it shows it at, as the page's box changes (`Window::_update_viewport_size`).
 *
 * @godot Window (protocol)
 * @source scene/main/window.cpp:1302
 */
export function GodotStretch({ children }: { readonly children?: ReactNode }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const stretch = size === null ? undefined : godot_window_stretch(size.width, size.height);
  const shown: CSSProperties =
    stretch === undefined
      ? { display: 'none' }
      : {
          position: 'absolute',
          left: stretch.margin.x,
          top: stretch.margin.y,
          width: stretch.visible.x,
          height: stretch.visible.y,
          transform: `scale(${String(stretch.screen.x / stretch.visible.x)}, ${String(stretch.screen.y / stretch.visible.y)})`,
          transformOrigin: '0 0',
        };
  // Godot's default theme's text, which the Controls inherit unless their theme or overrides say
  // otherwise (`default_theme.cpp:50`: 16 px).
  return createElement(
    'div',
    { ref: box, style: { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', fontSize: 16, fontFamily: 'sans-serif' } },
    createElement('div', { 'data-godot-canvas': '', style: shown }, children),
  );
}
