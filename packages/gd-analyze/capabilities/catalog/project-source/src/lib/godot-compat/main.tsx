/**
 * @godot-class Main
 * @role PROTOCOL
 *
 * Godot 4.7's `Main` (`main/main.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the
 * web export runs it, over the R3F canvas the project renders into: `Main::setup2` loads the
 * default theme font and creates the physics server's default space; `Main::start` makes the
 * root window, whose size is the canvas's, and hands it the renderer and the page's input; each
 * animation frame is `OS_Web::main_loop_iterate` (`platform/web/os_web.cpp:78`): the page's
 * buffered keys delivered, one `Main::iteration`, the 3D viewport drawn with its current camera
 * and the canvas items drawn over it. The settings and InputMap are loaded by the project's world
 * module before this component mounts; the scenes it wraps enter the tree after it has run.
 */

import RAPIER, { type World } from '@dimforge/rapier3d-compat';
import { useFrame, useThree } from '@react-three/fiber';
import { createElement, Fragment, type PropsWithChildren, useEffect, useLayoutEffect, useState } from 'react';
import { godot_camera_3d_draw } from './camera-3d';
import { godot_canvas_draw } from './canvas-item';
import { godot_font_default, godot_font_default_url, godot_font_load } from './font';
import { godot_main_timer_sync_init } from './main-timer-sync';
import { godot_resource_loader_settled } from './resource-loader';
import { godot_main_iteration, godot_tree_set_root } from './scene-tree';
import { godot_viewport_attach_input, godot_viewport_attach_renderer } from './viewport';
import {
  godot_window_attach_input,
  godot_window_canvas_layer,
  godot_window_canvas_size,
  godot_window_process_events,
  godot_window_set_size,
} from './window';
import { godot_world_3d_attach } from './world-3d';

/** `OS_Web::get_ticks_usec`: the page's clock in whole microseconds. */
const ticksUsec = (): number => Math.floor(performance.now() * 1000);

/** `Main::start` and each frame's iteration, on the canvas R3F renders into. */
function GodotMainLoop({ world }: { readonly world: World }) {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const set = useThree((state) => state.set);
  const get = useThree((state) => state.get);
  useLayoutEffect(() => {
    godot_tree_set_root(scene);
    godot_world_3d_attach(world);
    const releaseRenderer = godot_viewport_attach_renderer(gl);
    const releaseInput = godot_window_attach_input(gl.domElement);
    const releaseDispatch = godot_viewport_attach_input(scene);
    godot_main_timer_sync_init(ticksUsec());
    return () => {
      releaseDispatch();
      releaseInput();
      releaseRenderer();
    };
  }, [scene, gl, world]);
  useLayoutEffect(() => {
    godot_window_set_size(scene, godot_window_canvas_size(gl.domElement));
  }, [scene, gl, size]);
  useFrame(() => {
    godot_window_process_events();
    godot_main_iteration(ticksUsec());
    const camera = godot_camera_3d_draw(scene);
    if (camera !== null && get().camera !== camera) set({ camera });
    godot_canvas_draw(scene, godot_window_canvas_layer(gl.domElement));
  });
  return null;
}

/**
 * The project's main loop: once Rapier's module and the default theme font (the capability's own
 * `OpenSans_SemiBold.woff2`) are loaded, the default space is a Rapier world handed to World3D
 * (whose gravity is zero: the space's gravity and damping are compat's, from the project's
 * `physics/3d/default_*` settings), the root window takes the canvas, and `children` (the autoloads
 * and the main scene) mount after the loop has registered the tree root.
 *
 * @godot Main (protocol)
 * @source main/main.cpp:4495
 */
export function GodotMain({ children }: PropsWithChildren) {
  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => {
    let live = true;
    // The font file is measured by compat's text server and registered with the page as the
    // `godot-default-font` face the canvas items and Label3D draw their glyphs in.
    const font = fetch(godot_font_default_url())
      .then((response) => response.arrayBuffer())
      .then(async (bytes) => {
        const page = (globalThis as { readonly document?: Document }).document;
        if (page?.fonts !== undefined && typeof FontFace === 'function') {
          const face = new FontFace('godot-default-font', bytes.slice(0));
          page.fonts.add(await face.load());
        }
        return bytes;
      });
    // The scenes' imported resources (textures, …) load before any scene is instantiated.
    void Promise.all([RAPIER.init(), font, godot_resource_loader_settled()]).then(([, bytes]) => {
      if (!live) return;
      godot_font_default(godot_font_load(new Uint8Array(bytes)));
      setWorld(new RAPIER.World({ x: 0, y: 0, z: 0 }));
    });
    return () => {
      live = false;
    };
  }, []);
  if (world === null) return null;
  return createElement(Fragment, null, createElement(GodotMainLoop, { world }), children);
}
