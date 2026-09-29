/**
 * @godot-class Control
 * @role PROTOCOL
 *
 * The page's Controls (docs/GODOT.md "UI is React DOM"). A scene renders each Control as a React
 * DOM element; React DOM cannot render inside R3F's Canvas, so the Controls under a node that
 * renders none (a CanvasLayer, a Node3D, the tree's root for a Control main scene) are sent through
 * the game's `tunnel-rat` tunnel (`src/ui.tsx`) inside a host element that stands for that node
 * (`godot_node_dom_host`), with the contexts of the place they were written in bridged across
 * (`its-fine`). The game's `dom` root renders them over the world, laid out at the project's 2D
 * size and scaled to the page as Godot stretches its 2D (`GodotStretch`, `window.ts`).
 */

import { useThree } from '@react-three/fiber';
import { useContextBridge } from 'its-fine';
import { type CSSProperties, createElement, type ReactElement, type ReactNode, type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { godot_node_dom_host } from './node';
import { godot_element_node } from './react-lifecycle';
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

/** A `tunnel-rat` tunnel: what is rendered in its `In` is rendered where its `Out` is. */
export interface GodotControlsTunnel {
  readonly In: (props: { readonly children: ReactNode }) => ReactNode;
  readonly Out: () => ReactNode;
}

/** The host fills the overlay and passes pointer input on, but for the Controls that take it. */
const HOST: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };

/**
 * Controls sent to the page (`<GodotControls ui={ui} parent={layer}>`): their host element stands
 * for `parent` (the tree's root when there is none) in the Node tree, stacked by `style` (a
 * CanvasLayer's `layer`, its visibility).
 *
 * @godot Control (protocol)
 * @source scene/main/canvas_layer.cpp:359
 */
export function GodotControls({
  ui,
  parent,
  style,
  children,
}: {
  readonly ui: GodotControlsTunnel;
  readonly parent?: RefObject<object | null>;
  readonly style?: CSSProperties;
  readonly children?: ReactNode;
}): ReactElement {
  const Bridge = useContextBridge();
  const root = useThree((state) => state.scene);
  const held = useRef<object | null>(null);
  const host = useCallback(
    (element: HTMLDivElement | null) => {
      const node = parent === undefined ? root : godot_element_node(parent.current);
      if (element !== null) held.current = node;
      const standing = element === null ? held.current : node;
      if (standing !== null) godot_node_dom_host(standing, element);
    },
    [parent, root],
  );
  return createElement(ui.In, null, createElement(Bridge, null, createElement('div', { ref: host, style: { ...HOST, ...style } }, children)));
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
