/**
 * @godot-class Main
 * @role BINDING
 *
 * What Godot 4.7's `Main` sets up before a game runs (`main/main.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`), as hooks the emitted world calls: its resources
 * (the default theme font, `Main::setup2`, and the scenes' imported resources), and the world's
 * wiring (`Main::start`: the renderer and the page's input handed to the root window, whose size is
 * the canvas's; the `<Physics>` world handed to compat's physics). Nothing here runs per frame: the
 * world's own `useFrame` and physics-step hooks deliver input, choose the current camera and draw
 * the canvas items, and Rapier steps the physics.
 */

import { useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { use, useEffect, useLayoutEffect, useReducer } from 'react';
import { godot_collision_object_of_collider, godot_physics_attach } from './collision-object-3d';
import { godot_physics_body_3d_collides } from './physics-body-3d';
import { godot_font_default, godot_font_default_url, godot_font_load } from './font';
import { godot_resource_loader_settled } from './resource-loader';
import { godot_tree_on_reload } from './scene-tree';
import { godot_viewport_attach_input, godot_viewport_attach_renderer } from './viewport';
import { godot_window_attach_input, godot_window_canvas_size, godot_window_set_size } from './window';
// The body classes' modules register their `is` classes and signals as they load.
import './area-3d';
import './character-body-3d';
import './rigid-body-3d';
import './static-body-3d';

let resources: Promise<void> | undefined;

/** The default theme font (measured by compat's text server and registered with the page) and the scenes' imported resources. */
function loadResources(): Promise<void> {
  resources ??= (async () => {
    const bytes = await fetch(godot_font_default_url()).then((response) => response.arrayBuffer());
    const page = (globalThis as { readonly document?: Document }).document;
    if (page?.fonts !== undefined && typeof FontFace === 'function') {
      const face = new FontFace('godot-default-font', bytes.slice(0));
      page.fonts.add(await face.load());
    }
    await godot_resource_loader_settled();
    godot_font_default(godot_font_load(new Uint8Array(bytes)));
  })();
  return resources;
}

/**
 * Suspends until the game's resources have loaded, as `Main::setup2` loads them before the first
 * scene: render the world under `<Suspense>`.
 *
 * @godot Main (protocol)
 * @source main/main.cpp:3401
 */
export function useGodotResources(): void {
  use(loadResources());
}

/**
 * Wires the world once: the `<Physics>` world to compat's physics, the renderer and the page's
 * input to the root window, and the window's size to the canvas's.
 *
 * @godot Main (protocol)
 * @source main/main.cpp:4495
 */
export function useGodotWorld(): void {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const rapier = useRapier();
  useLayoutEffect(() => {
    const releasePhysics = godot_physics_attach(rapier);
    // A pair of bodies one of which excepts the other never touches (`add_collision_exception_with`).
    const exceptions = {
      current: (collider1: number, collider2: number) => {
        const a = godot_collision_object_of_collider(rapier.world.getCollider(collider1));
        const b = godot_collision_object_of_collider(rapier.world.getCollider(collider2));
        return a !== undefined && b !== undefined && !godot_physics_body_3d_collides(a, b) ? 0 : null;
      },
    };
    rapier.filterContactPairHooks.add(exceptions as never);
    const releaseRenderer = godot_viewport_attach_renderer(gl);
    const releaseInput = godot_window_attach_input(gl.domElement);
    const releaseDispatch = godot_viewport_attach_input(scene);
    return () => {
      releaseDispatch();
      releaseInput();
      releaseRenderer();
      rapier.filterContactPairHooks.delete(exceptions as never);
      releasePhysics();
    };
  }, [scene, gl, rapier]);
  useLayoutEffect(() => {
    godot_window_set_size(scene, godot_window_canvas_size(gl.domElement));
  }, [scene, gl, size]);
}

/**
 * The main scene's generation, which `reload_current_scene` advances: the world keys the main
 * scene by it, so React unmounts it and mounts it anew, as `SceneTree::_flush_scene_change`
 * frees the current scene and adds a new instance of it.
 *
 * @godot SceneTree (protocol)
 * @source scene/main/scene_tree.cpp:1673
 */
export function useGodotSceneReload(): number {
  const [generation, reload] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    godot_tree_on_reload(reload);
    return () => godot_tree_on_reload(undefined);
  }, []);
  return generation;
}
