/**
 * @godot-class SubViewport
 * @role BINDING
 *
 * Godot 4.7's `SubViewport` (`scene/main/viewport.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a viewport whose image is its own, `size` pixels,
 * which a ViewportTexture shows on a material (`viewport-texture.ts`) and a SubViewportContainer
 * over its rect (`sub-viewport-container.ts`). Its image is a 2D canvas, drawn each frame its update
 * mode asks for (from its own component's frame, before R3F renders): its background (Godot's
 * default clear colour, or nothing with `transparent_bg`), its 3D through its current Camera3D
 * unless `disable_3d`, and its canvas items over it (`godot_canvas_item_paint`), through its current
 * Camera2D.
 *
 * Its 3D world is its parent's, as Godot's is without `own_world_3d` (its nodes are in the world
 * everyone sees, drawn again through its camera); with `own_world_3d`, its nodes are its own: the
 * page's frame leaves them out and the viewport draws them alone. The 3D is rendered into a target
 * with R3F's renderer, encoded to sRGB (the viewport's 2D is sRGB, as Godot's 2D is), and read back
 * without stalling (`readRenderTargetPixelsAsync`): the image shows the 3D of the frame before.
 * Its physics is the page's one world; its input is the page's (`gui_disable_input` is stored).
 */

import type { ReactElement } from 'react';
import {
  type Camera,
  type CanvasTexture,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  type PerspectiveCamera,
  ShaderMaterial,
  Group,
  UnsignedByteType,
  type WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
} from 'three';
import { useThree } from '@react-three/fiber';
import { createElement } from 'react';
import { useGodotDraw } from './advance';
import { godot_canvas_item_paint, godot_canvas_item_viewport_root } from './canvas-item';
import { is_inside_tree } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { godot_object_signal } from './signal';
import { construct as vector2 } from './vector2';
import { construct as vector2i, type Vector2i } from './vector2i';

const SIZE = new WeakMap<Object3D, Vector2i>();

/**
 * Stores `p_size.maxi(2)`, each component at least 2 (`Viewport::_set_size`,
 * `scene/main/viewport.cpp:1153`); the image is drawn at that size.
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

/** `SubViewport::UpdateMode` (`sub_viewport.h:47`): disabled, once, when visible, when the parent is visible, always. */
const UPDATE_DISABLED = 0;
const UPDATE_ONCE = 1;

interface SubViewportState {
  updateMode: number;
  transparentBackground: boolean;
  disable3d: boolean;
  ownWorld3d: boolean;
  disableInput: boolean;
  /** The viewport's image. */
  canvas: HTMLCanvasElement | undefined;
  /** The last 3D image read back, which each drawing puts under the 2D. */
  image3d: HTMLCanvasElement | undefined;
  /** The textures showing the image, told each time it is drawn. */
  readonly textures: Set<CanvasTexture>;
  target: WebGLRenderTarget | undefined;
  encoded: WebGLRenderTarget | undefined;
  reading: boolean;
}

const SUBVIEWPORTS = new WeakMap<object, SubViewportState>();

function stateOf(self: object): SubViewportState {
  let state = SUBVIEWPORTS.get(self);
  if (state === undefined) {
    state = {
      updateMode: 2,
      transparentBackground: false,
      disable3d: false,
      ownWorld3d: false,
      disableInput: false,
      canvas: undefined,
      image3d: undefined,
      textures: new Set(),
      target: undefined,
      encoded: undefined,
      reading: false,
    };
    SUBVIEWPORTS.set(self, state);
  }
  return state;
}

/**
 * Whether an object is a SubViewport: the viewport of the cameras and canvas items under it.
 *
 * @godot SubViewport (protocol)
 * @source scene/main/viewport.cpp:5611
 */
export function godot_sub_viewport_is(object: object): boolean {
  return SUBVIEWPORTS.has(object);
}

/** The viewport's image, made at its size as it is first drawn or shown. */
function canvasOf(state: SubViewportState, size: Vector2i): HTMLCanvasElement {
  const canvas = state.canvas ?? document.createElement('canvas');
  state.canvas = canvas;
  if (canvas.width !== size.x) canvas.width = size.x;
  if (canvas.height !== size.y) canvas.height = size.y;
  return canvas;
}

/**
 * The viewport's image, as a SubViewportContainer shows it and a ViewportTexture samples it; the
 * texture is told each time it is drawn.
 *
 * @godot Viewport.get_texture
 * @source scene/main/viewport.cpp:1416
 */
export function godot_sub_viewport_image(self: object, texture?: CanvasTexture): HTMLCanvasElement {
  const state = stateOf(self);
  if (texture !== undefined) state.textures.add(texture);
  return canvasOf(state, get_size(self as Object3D));
}

/** The encoding of the 3D into the viewport's sRGB image. */
const ENCODE = new ShaderMaterial({
  uniforms: { source: { value: null } },
  vertexShader: 'varying vec2 vUv;\nvoid main() {\n\tvUv = uv;\n\tgl_Position = vec4(position.xy, 0.0, 1.0);\n}',
  fragmentShader: [
    'uniform sampler2D source;',
    'varying vec2 vUv;',
    'vec3 srgb(vec3 c) {',
    '\treturn mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));',
    '}',
    'void main() {',
    '\tvec4 c = texture2D(source, vUv);',
    '\tgl_FragColor = vec4(srgb(clamp(c.rgb, 0.0, 1.0)), clamp(c.a, 0.0, 1.0));',
    '}',
  ].join('\n'),
  depthTest: false,
  depthWrite: false,
});
const QUAD = new Mesh(new PlaneGeometry(2, 2), ENCODE);
const QUAD_CAMERA = new OrthographicCamera();

/** The camera the viewport draws with: its current Camera3D (`camera-3d.ts` registers it here). */
const CAMERAS = new WeakMap<object, () => PerspectiveCamera | null>();

/**
 * How the viewport finds its current Camera3D (`Viewport::get_camera_3d`), as camera-3d.ts keeps it.
 *
 * @godot Viewport (protocol)
 * @source scene/main/viewport.cpp:4776
 */
export function godot_sub_viewport_camera_source(self: object, camera: () => PerspectiveCamera | null): void {
  CAMERAS.set(self, camera);
}

/** Its 3D through its camera, into the target, then encoded and read back into `image3d`. */
function draw3d(entity: Object3D, state: SubViewportState, renderer: WebGLRenderer, camera: Camera, size: Vector2i): void {
  const target = state.target ?? new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType });
  const encoded = state.encoded ?? new WebGLRenderTarget(size.x, size.y, { type: UnsignedByteType });
  state.target = target;
  state.encoded = encoded;
  if (target.width !== size.x || target.height !== size.y) {
    target.setSize(size.x, size.y);
    encoded.setSize(size.x, size.y);
  }
  let world: Object3D = entity;
  if (!state.ownWorld3d) while (world.parent !== null) world = world.parent;
  const previous = renderer.getRenderTarget();
  const alpha = renderer.getClearAlpha();
  if (state.transparentBackground) renderer.setClearAlpha(0);
  // An own world is drawn alone: the page's frame leaves it out (`godot_sub_viewport_mount`).
  if (state.ownWorld3d) entity.visible = true;
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(world, camera);
  if (state.ownWorld3d) entity.visible = false;
  (ENCODE.uniforms['source'] as { value: unknown }).value = target.texture;
  renderer.setRenderTarget(encoded);
  renderer.render(QUAD, QUAD_CAMERA);
  renderer.setRenderTarget(previous);
  renderer.setClearAlpha(alpha);
  if (state.reading) return;
  state.reading = true;
  const pixels = new Uint8Array(size.x * size.y * 4);
  void renderer.readRenderTargetPixelsAsync(encoded, 0, 0, size.x, size.y, pixels).then(() => {
    state.reading = false;
    const image = state.image3d ?? document.createElement('canvas');
    state.image3d = image;
    image.width = size.x;
    image.height = size.y;
    const context = image.getContext('2d');
    if (context === null) return;
    // GL's rows run bottom up; the canvas's top down.
    const data = context.createImageData(size.x, size.y);
    const row = size.x * 4;
    for (let y = 0; y < size.y; y += 1) data.data.set(pixels.subarray((size.y - 1 - y) * row, (size.y - y) * row), y * row);
    context.putImageData(data, 0, 0);
  });
}

/**
 * One drawing of the viewport's image (`RendererViewport::draw_viewports`): its background, its 3D,
 * its canvas items; the textures showing it are told.
 */
function drawImage(entity: Object3D, state: SubViewportState, renderer: WebGLRenderer): void {
  if (!is_inside_tree(entity) || state.updateMode === UPDATE_DISABLED) return;
  const size = get_size(entity);
  const canvas = canvasOf(state, size);
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.clearRect(0, 0, size.x, size.y);
  if (!state.transparentBackground) {
    // `rendering/environment/defaults/default_clear_color`, Color(0.3, 0.3, 0.3).
    context.fillStyle = 'rgb(77, 77, 77)';
    context.fillRect(0, 0, size.x, size.y);
  }
  const camera = state.disable3d ? null : (CAMERAS.get(entity)?.() ?? null);
  if (camera !== null) {
    draw3d(entity, state, renderer, camera, size);
    if (state.image3d !== undefined) context.drawImage(state.image3d, 0, 0);
  }
  godot_canvas_item_paint(entity, context);
  for (const texture of state.textures) texture.needsUpdate = true;
  if (state.updateMode === UPDATE_ONCE) state.updateMode = UPDATE_DISABLED;
}

/**
 * Makes `entity` a SubViewport: the viewport of the cameras and canvas items under it, its image
 * drawn by its component (`GodotSubViewport`).
 *
 * @godot SubViewport (protocol)
 * @source scene/main/viewport.cpp:4960
 */
export function godot_sub_viewport_mount(entity: Object3D): void {
  const state = stateOf(entity);
  godot_canvas_item_viewport_root(entity, () => {
    const size = get_size(entity);
    return vector2(size.x, size.y);
  });
  // An own world is left out of the page's frame; the viewport shows it alone.
  if (state.ownWorld3d) entity.visible = false;
}

/**
 * @godot SubViewport.set_update_mode
 * @source scene/main/viewport.cpp:5686
 */
export function set_update_mode(self: object, mode: number): void {
  stateOf(self).updateMode = mode;
}

/**
 * @godot SubViewport.get_update_mode
 * @source scene/main/viewport.cpp:5692
 */
export function get_update_mode(self: object): number {
  return stateOf(self).updateMode;
}

/**
 * Whether a sub-viewport draws its background (`Viewport::set_transparent_background`, which
 * `viewport.ts` binds).
 *
 * @godot SubViewport (protocol)
 * @source scene/main/viewport.cpp:1302
 */
export function godot_sub_viewport_set_transparent(self: object, transparent: boolean): void {
  stateOf(self).transparentBackground = transparent;
}

/**
 * @godot Viewport.set_disable_3d
 * @source scene/main/viewport.cpp:4839
 */
export function set_disable_3d(self: object, disable: boolean): void {
  stateOf(self).disable3d = disable;
}

/**
 * @godot Viewport.is_3d_disabled
 * @source scene/main/viewport.cpp:4845
 */
export function is_3d_disabled(self: object): boolean {
  return stateOf(self).disable3d;
}

/**
 * Its nodes' own world, left out of the page's frame, or its parent's.
 *
 * @godot Viewport.set_use_own_world_3d
 * @source scene/main/viewport.cpp:4925
 */
export function set_use_own_world_3d(self: object, own: boolean): void {
  const state = stateOf(self);
  state.ownWorld3d = own;
  (self as Object3D).visible = !own;
}

/**
 * @godot Viewport.is_using_own_world_3d
 * @source scene/main/viewport.cpp:4960
 */
export function is_using_own_world_3d(self: object): boolean {
  return stateOf(self).ownWorld3d;
}

/**
 * Stored: input reaches the one viewport the page has.
 *
 * @godot Viewport.set_disable_input
 * @source scene/main/viewport.cpp:3716
 */
export function set_disable_input(self: object, disable: boolean): void {
  stateOf(self).disableInput = disable;
}

/**
 * @godot Viewport.is_input_disabled
 * @source scene/main/viewport.cpp:3729
 */
export function is_input_disabled(self: object): boolean {
  return stateOf(self).disableInput;
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
    ['disable3d', (entity, value: boolean) => set_disable_3d(entity, value)],
    ['ownWorld3d', (entity, value: boolean) => set_use_own_world_3d(entity, value)],
    ['guiDisableInput', (entity, value: boolean) => set_disable_input(entity, value)],
    // Input reaches the one viewport the page has; multisampling is the renderer's.
    ['handleInputLocally', () => undefined],
    ['msaa3d', () => undefined],
  ]),
};

/** The viewport's image drawn from its own component's frame. */
function Draw({ entity }: { readonly entity: Object3D }): null {
  const get = useThree((three) => three.get);
  useGodotDraw(entity, () => drawImage(entity, stateOf(entity), get().gl));
  return null;
}

/**
 * A SubViewport as a scene writes it: `<GodotSubViewport size={[256, 256]} disable3d>…</GodotSubViewport>`.
 *
 * @godot SubViewport (protocol)
 * @source scene/main/viewport.cpp:4960
 */
export function GodotSubViewport(props: GodotElementProps<Group>): ReactElement {
  const element = useGodotElement(SUB_VIEWPORT, props);
  const entity = (element.props as { readonly object: Group }).object;
  return createElement('primitive', { ...(element.props as object) }, props.children, createElement(Draw, { key: 'draw', entity }));
}
