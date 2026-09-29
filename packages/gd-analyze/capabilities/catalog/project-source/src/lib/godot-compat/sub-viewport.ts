/**
 * @godot-class SubViewport
 * @role BINDING
 *
 * Godot 4.7's `SubViewport.size`, at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. The
 * receiver is the `THREE.Scene` that holds the viewport's 3D world: a Node3D's viewport is its
 * topmost three ancestor. The pixel size is Godot state no three object holds (the host renders
 * the scene at whatever size its canvas has), so it lives in `SIZE`, keyed by the Scene; an unset
 * viewport has Godot's default `Size2i(512, 512)` (`scene/main/viewport.h:262`).
 */

import type { ReactElement } from 'react';
import { type Camera, Group, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { godot_node_tree_signal } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { godot_object_signal } from './signal';
import { construct as vector2i, type Vector2i } from './vector2i';

const SIZE = new WeakMap<Object3D, Vector2i>();

/**
 * Stores `p_size.maxi(2)`, each component at least 2 (`Viewport::_set_size`,
 * `scene/main/viewport.cpp:1153`); Godot then resizes the render target, which the host does for
 * its own canvas.
 *
 * @godot SubViewport.set_size
 * @source scene/main/viewport.cpp:5611
 */
export function set_size(self: Object3D, p_size: Vector2i): void {
  const size = vector2i(Math.max(p_size.x, 2), Math.max(p_size.y, 2));
  const previous = SIZE.get(self) ?? vector2i(512, 512);
  SIZE.set(self, size);
  // A changed size emits `size_changed` (`viewport.cpp:1188`).
  if (previous.x === size.x && previous.y === size.y) return;
  godot_object_signal<[]>(self, 'size_changed').emit();
}

/**
 * @godot SubViewport.get_size
 * @source scene/main/viewport.cpp:5640
 */
export function get_size(self: Object3D): Vector2i {
  return SIZE.get(self) ?? vector2i(512, 512);
}

/** `SubViewport::UpdateMode` (`sub_viewport.h:47`): disabled (0) to always (4). */
const UPDATE_DISABLED = 0;

interface SubViewportState {
  updateMode: number;
  transparentBackground: boolean;
}

const SUBVIEWPORTS = new WeakMap<object, SubViewportState>();

function stateOf(self: object): SubViewportState {
  let state = SUBVIEWPORTS.get(self);
  if (state === undefined) {
    state = { updateMode: 2, transparentBackground: false };
    SUBVIEWPORTS.set(self, state);
  }
  return state;
}

/** The camera the sub-viewport draws with: the first Camera3D in it (its current camera). */
function cameraOf(viewport: Object3D): PerspectiveCamera | undefined {
  let found: PerspectiveCamera | undefined;
  viewport.traverse((object) => {
    if (found === undefined && (object as PerspectiveCamera).isPerspectiveCamera === true) found = object as PerspectiveCamera;
  });
  return found;
}

/**
 * Draws a sub-viewport that shares its parent's 3D world (`own_world_3d` off) over the frame, as
 * its SubViewportContainer shows it stretched over its rect: after the world's own pass, the world
 * again through the sub-viewport's camera (its cull mask choosing what it sees), its depth cleared
 * and, with `transparent_bg`, no background.
 *
 * @godot SubViewport (protocol)
 * @source scene/main/viewport.cpp:4960
 */
export function godot_sub_viewport_mount(entity: Object3D): void {
  const state = stateOf(entity);
  let drawing = false;
  godot_node_tree_signal(entity, 'tree_entered').connect(() => {
    let world: Object3D = entity;
    while (world.parent !== null) world = world.parent;
    const scene = world as Scene;
    const previous = scene.onAfterRender;
    scene.onAfterRender = (renderer: WebGLRenderer, target: Scene, camera: Camera, ...rest: never[]) => {
      (previous as (...args: unknown[]) => void).call(scene, renderer, target, camera, ...rest);
      const own = cameraOf(entity);
      if (drawing || own === undefined || camera === own || state.updateMode === UPDATE_DISABLED || !entity.visible) return;
      drawing = true;
      const autoClear = renderer.autoClear;
      const background = scene.background;
      renderer.autoClear = false;
      renderer.clearDepth();
      if (state.transparentBackground) scene.background = null;
      const aspect = (camera as PerspectiveCamera).aspect;
      if (aspect !== undefined && own.aspect !== aspect) {
        own.aspect = aspect;
        own.updateProjectionMatrix();
      }
      renderer.render(scene, own);
      scene.background = background;
      renderer.autoClear = autoClear;
      drawing = false;
    };
  });
}

/**
 * @godot SubViewport.set_update_mode
 * @source scene/main/viewport.cpp:5667
 */
export function set_update_mode(self: object, mode: number): void {
  stateOf(self).updateMode = mode;
}

/**
 * @godot SubViewport.get_update_mode
 * @source scene/main/viewport.cpp:5673
 */
export function get_update_mode(self: object): number {
  return stateOf(self).updateMode;
}

/**
 * Whether a sub-viewport draws its background (`Viewport::set_transparent_background`).
 *
 * @godot SubViewport (protocol)
 * @source scene/main/viewport.cpp:1334
 */
export function godot_sub_viewport_set_transparent(self: object, transparent: boolean): void {
  stateOf(self).transparentBackground = transparent;
}

const SUB_VIEWPORT = {
  create: () => new Group(),
  classes: ['SubViewport', 'Viewport', 'Node', 'Object'],
  spatial: false,
  mount: godot_sub_viewport_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ['size', (entity, value: readonly [number, number]) => set_size(entity, vector2i(...value))],
    ['renderTargetUpdateMode', (entity, value: number) => set_update_mode(entity, value)],
    ['transparentBg', (entity, value: boolean) => godot_sub_viewport_set_transparent(entity, value)],
    // Input reaches the one viewport the page has; multisampling is the renderer's.
    ['handleInputLocally', () => undefined],
    ['msaa3d', () => undefined],
  ]),
};

/**
 * A SubViewport as a scene writes it: `<GodotSubViewport size={[1280, 720]} transparentBg />`.
 *
 * @godot SubViewport (protocol)
 * @source scene/main/viewport.cpp:4960
 */
export function GodotSubViewport(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(SUB_VIEWPORT, props);
}
