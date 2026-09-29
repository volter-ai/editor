/**
 * @godot-class ShaderMaterial
 * @role PROTOCOL
 *
 * A ShaderMaterial of a `canvas_item` shader drawing a canvas item on the page: the item's rect as
 * one quad through the translation's lowered `fragment()` (`canvas-shader.ts`), `COLOR` the item's
 * colour times Godot's default white 4×4 texture (`texture_storage.cpp:85`), drawn by one offscreen
 * three renderer into a canvas that is the item's drawing. It is drawn after R3F renders the frame
 * (R3F's after-render effect), so its screen texture (`hint_screen_texture`) is that frame, read
 * from the page's canvas; the canvas items drawn on the page before it are not in it, which Godot's
 * screen copy would hold. Its uniforms are the shader's defaults and then the material's
 * parameters, `source_color` unconverted as Godot's 2D is sRGB; its `modulate` is the item
 * element's, as every canvas item's is here.
 */

import { addAfterEffect } from '@react-three/fiber';
import {
  CanvasTexture,
  DataTexture,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial as ThreeShaderMaterial,
  type Texture,
  Uniform,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
  Vector4 as ThreeVector4,
  WebGLRenderer,
} from 'three';
import type { Color } from './color';
import { godot_engine_ticks } from './engine';
import type { GodotShaderUniform } from './shader';
import type { ShaderMaterial } from './shader-material';
import { godot_window_canvas_of } from './window';

/** `ShaderLanguage::TextureFilter` and `TextureRepeat` (`servers/rendering/shader_language.h:331`). */
const FILTER_NEAREST = 0;
const REPEAT_ENABLE = 1;

/** One item to draw after the frame: its drawing's canvas, material, colour and place on the screen. */
interface Shaded {
  readonly canvas: HTMLCanvasElement;
  readonly material: ShaderMaterial;
  readonly color: Color;
  /** The item's rect on the screen, in screen UV from the top-left, and its size in pixels. */
  readonly rect: readonly [number, number, number, number];
  readonly pixels: readonly [number, number];
  readonly screenPixel: readonly [number, number];
  readonly root: HTMLElement;
}

const PENDING = new Map<object, Shaded>();
const DRAWINGS = new WeakMap<object, HTMLCanvasElement>();
const THREE_MATERIALS = new WeakMap<ShaderMaterial, ThreeShaderMaterial>();
let renderer: WebGLRenderer | undefined;
let armed = false;
const quad = new Mesh(new PlaneGeometry(2, 2));
const camera = new OrthographicCamera();
/** Godot's default white texture, 4×4, which an untextured draw samples. */
const WHITE = new DataTexture(new Uint8Array(4 * 4 * 4).fill(255), 4, 4);
WHITE.needsUpdate = true;
/** The page's canvas as the screen texture, uploaded once per frame. */
const SCREENS = new WeakMap<HTMLCanvasElement, CanvasTexture>();

/** A uniform's value as three's uniform holds it (`source_color` unconverted: 2D is sRGB). */
function uniformValue(uniform: GodotShaderUniform, value: unknown): unknown {
  if (uniform.type.startsWith('sampler')) {
    const texture = value as Texture | null | undefined;
    if (texture !== null && texture !== undefined) {
      if (uniform.filter === FILTER_NEAREST) texture.magFilter = texture.minFilter = NearestFilter;
      if (uniform.repeat === REPEAT_ENABLE) texture.wrapS = texture.wrapT = RepeatWrapping;
    }
    return texture ?? null;
  }
  const values: number[] = Array.isArray(value)
    ? (value as number[])
    : typeof value === 'number' || typeof value === 'boolean'
      ? [Number(value)]
      : typeof value === 'object' && value !== null
        ? 'r' in value
          ? [(value as Color).r, (value as Color).g, (value as Color).b, (value as Color).a]
          : Object.values(value as Record<string, number>)
        : [];
  switch (uniform.type) {
    case 'vec2':
      return new ThreeVector2(values[0] ?? 0, values[1] ?? 0);
    case 'vec3':
      return new ThreeVector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
    case 'vec4':
      return new ThreeVector4(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1);
    case 'bool':
      return (values[0] ?? 0) !== 0;
    default:
      return values[0] ?? 0;
  }
}

/** The three material a canvas ShaderMaterial draws with, made once and kept current with its parameters. */
function threeMaterialOf(material: ShaderMaterial): ThreeShaderMaterial | undefined {
  const held = THREE_MATERIALS.get(material);
  if (held !== undefined) return held;
  const lowered = material.shader?.lowered;
  const stages = lowered?.canvas;
  if (lowered === undefined || stages === undefined) return undefined;
  const uniforms: Record<string, Uniform> = {
    godot_TIME: new Uniform(0),
    godot_TEXTURE: new Uniform(WHITE),
    godot_TEXTURE_PIXEL_SIZE: new Uniform(new ThreeVector2(0.25, 0.25)),
    godot_COLOR_IN: new Uniform(new ThreeVector4(1, 1, 1, 1)),
    godot_SCREEN_RECT: new Uniform(new ThreeVector4(0, 0, 1, 1)),
    godot_SCREEN_PIXEL_SIZE: new Uniform(new ThreeVector2(1, 1)),
  };
  const byName = new Map(lowered.uniforms.map((uniform) => [uniform.name, uniform] as const));
  for (const uniform of lowered.uniforms) {
    const value = material.parameters.has(uniform.name) ? material.parameters.get(uniform.name) : uniform.default;
    uniforms[uniform.glsl] = new Uniform(uniform.source !== undefined ? null : uniformValue(uniform, value ?? []));
  }
  const made = new ThreeShaderMaterial({ vertexShader: stages.vertexShader, fragmentShader: stages.fragmentShader, uniforms, transparent: true, depthTest: false, depthWrite: false });
  material.listeners.add((name, value) => {
    const uniform = byName.get(name);
    if (uniform === undefined || uniform.source !== undefined) return;
    (uniforms[uniform.glsl] as Uniform).value = uniformValue(uniform, value ?? uniform.default ?? []);
  });
  THREE_MATERIALS.set(material, made);
  return made;
}

/** Each pending item drawn: the offscreen renderer at its pixel size, then copied into its drawing. */
function drawPending(): void {
  if (PENDING.size === 0) return;
  renderer ??= new WebGLRenderer({ alpha: true, premultipliedAlpha: false });
  const drawer = renderer;
  const uploaded = new Set<CanvasTexture>();
  const time = godot_engine_ticks();
  for (const shaded of PENDING.values()) {
    const three = threeMaterialOf(shaded.material);
    const lowered = shaded.material.shader?.lowered;
    if (three === undefined || lowered === undefined) continue;
    const page = godot_window_canvas_of(shaded.root);
    const screen = page === undefined ? undefined : (SCREENS.get(page) ?? new CanvasTexture(page));
    if (page !== undefined && screen !== undefined) {
      SCREENS.set(page, screen);
      if (!uploaded.has(screen)) {
        screen.needsUpdate = true;
        uploaded.add(screen);
      }
    }
    const u = three.uniforms;
    (u['godot_TIME'] as Uniform).value = time;
    (u['godot_COLOR_IN'] as Uniform<ThreeVector4>).value.set(shaded.color.r, shaded.color.g, shaded.color.b, shaded.color.a);
    (u['godot_SCREEN_RECT'] as Uniform<ThreeVector4>).value.set(...shaded.rect);
    (u['godot_SCREEN_PIXEL_SIZE'] as Uniform<ThreeVector2>).value.set(...shaded.screenPixel);
    for (const uniform of lowered.uniforms) if (uniform.source === 'screen') (u[uniform.glsl] as Uniform).value = screen ?? null;
    const [width, height] = shaded.pixels;
    drawer.setSize(width, height, false);
    quad.material = three;
    drawer.render(quad, camera);
    const drawing = shaded.canvas;
    if (drawing.width !== width) drawing.width = width;
    if (drawing.height !== height) drawing.height = height;
    const context = drawing.getContext('2d');
    context?.clearRect(0, 0, width, height);
    context?.drawImage(drawer.domElement, 0, 0);
  }
  PENDING.clear();
}

/**
 * Draws a canvas item through its canvas_item ShaderMaterial, in place of its class's own drawing:
 * its drawing (a canvas in its element, `size` its own rect's) is drawn once R3F has rendered the
 * frame. `rect` is the item's on the screen (its corner and size in the 2D world, whose size is
 * `screen`).
 *
 * @godot ShaderMaterial (protocol)
 * @source servers/rendering/renderer_rd/renderer_canvas_render_rd.cpp:1794
 */
export function godot_canvas_shader_draw(
  entity: object,
  element: HTMLElement,
  root: HTMLElement,
  material: ShaderMaterial,
  color: Color,
  size: { readonly width: number; readonly height: number },
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  screen: { readonly width: number; readonly height: number },
): void {
  let drawing = DRAWINGS.get(entity);
  if (drawing === undefined) {
    drawing = element.ownerDocument.createElement('canvas');
    drawing.setAttribute('data-godot-content', '');
    drawing.style.position = 'absolute';
    drawing.style.left = '0px';
    drawing.style.top = '0px';
    DRAWINGS.set(entity, drawing);
  }
  if (drawing.parentElement !== element) element.insertBefore(drawing, element.firstChild);
  drawing.style.width = `${String(size.width)}px`;
  drawing.style.height = `${String(size.height)}px`;
  // The drawing's pixels: the 2D world's scaled to the page's canvas.
  const page = godot_window_canvas_of(root);
  const scale = page === undefined || screen.width <= 0 ? 1 : page.width / screen.width;
  const pixels: [number, number] = [Math.max(1, Math.round(rect.width * scale)), Math.max(1, Math.round(rect.height * scale))];
  PENDING.set(entity, {
    canvas: drawing,
    material,
    color,
    rect: [rect.x / screen.width, rect.y / screen.height, rect.width / screen.width, rect.height / screen.height],
    pixels,
    screenPixel: [1 / screen.width, 1 / screen.height],
    root,
  });
  if (!armed) {
    armed = true;
    addAfterEffect(drawPending);
  }
}

/**
 * Whether a material is a ShaderMaterial of a canvas_item shader, which draws its item here.
 *
 * @godot ShaderMaterial (protocol)
 * @source scene/resources/material.cpp:545
 */
export function godot_canvas_shader_material_is(material: unknown): material is ShaderMaterial {
  return typeof material === 'object' && material !== null && (material as ShaderMaterial).shader?.lowered?.canvas !== undefined;
}

/**
 * Takes an item's shader drawing off the page (its material is no longer a canvas shader).
 *
 * @godot ShaderMaterial (protocol)
 * @source scene/resources/material.cpp:545
 */
export function godot_canvas_shader_undraw(entity: object): void {
  DRAWINGS.get(entity)?.remove();
  PENDING.delete(entity);
}
