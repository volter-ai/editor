/**
 * @godot-class Main
 * @role BINDING
 *
 * What Godot 4.7's `Main` sets up before a game runs (`main/main.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`), as hooks the emitted world calls: its resources
 * (the default theme font, `Main::setup2`, and the scenes' imported resources), and the world's
 * wiring (`Main::start`: the renderer and the page's input handed to the root window, whose size is
 * the canvas's; the current camera handed to R3F as it changes; the `<Physics>` world handed to
 * compat's physics). The root Window is a node like any other: its own hook (`useGodotRootWindow`)
 * (`advance.tsx`) delivers the page's input and draws its canvas items, and Rapier steps the physics.
 */

import { SolverFlags } from '@dimforge/rapier3d-compat';
import { useThree } from '@react-three/fiber';
import { godot_camera_3d_attach_renderer, godot_camera_3d_viewport_resized } from './camera-3d';
import { useRapier } from '@react-three/rapier';
import { use, useEffect, useLayoutEffect, useReducer } from 'react';
import { godot_collision_object_of_collider, godot_physics_attach } from './collision-object-3d';
import { godot_physics_body_3d_collides } from './physics-body-3d';
import { godot_font_default, godot_font_default_url, godot_font_register } from './font';
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

/** The default theme font (registered with the page as a `FontFace`) and the scenes' imported resources. */
function loadResources(): Promise<void> {
  resources ??= godot_font_register(godot_font_default(), godot_font_default_url()).then(() => godot_resource_loader_settled());
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
  const get = useThree((state) => state.get);
  const set = useThree((state) => state.set);
  const rapier = useRapier();
  useLayoutEffect(() => {
    const releasePhysics = godot_physics_attach(rapier);
    // A pair of bodies one of which excepts the other never touches (`add_collision_exception_with`).
    // Rapier skips a pair whose filter answers `null` and solves one it answers `COMPUTE_IMPULSE`, so
    // every other pair a filtered collider meets answers `COMPUTE_IMPULSE`.
    const exceptions = {
      current: (collider1: number, collider2: number) => {
        // A collider the JS side has already removed while Rapier still lists the pair solves as any
        // other: nothing here may throw inside Rapier's step.
        const one = rapier.world.getCollider(collider1);
        const two = rapier.world.getCollider(collider2);
        if (one === undefined || two === undefined) return SolverFlags.COMPUTE_IMPULSE;
        const a = godot_collision_object_of_collider(one);
        const b = godot_collision_object_of_collider(two);
        return a !== undefined && b !== undefined && !godot_physics_body_3d_collides(a, b) ? null : SolverFlags.COMPUTE_IMPULSE;
      },
    };
    rapier.filterContactPairHooks.add(exceptions as never);
    const releaseRenderer = godot_viewport_attach_renderer(gl);
    const releaseInput = godot_window_attach_input(gl.domElement);
    const releaseDispatch = godot_viewport_attach_input(scene);
    const releaseCamera = godot_camera_3d_attach_renderer(scene, (camera) => {
      if (get().camera !== camera) set({ camera });
    });
    return () => {
      releaseCamera();
      releaseDispatch();
      releaseInput();
      releaseRenderer();
      rapier.filterContactPairHooks.delete(exceptions as never);
      releasePhysics();
    };
  }, [scene, gl, rapier, get, set]);
  useLayoutEffect(() => {
    godot_window_set_size(scene, godot_window_canvas_size(gl.domElement));
    godot_camera_3d_viewport_resized(scene);
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
