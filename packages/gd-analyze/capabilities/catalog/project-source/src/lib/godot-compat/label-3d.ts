/**
 * @godot-class Label3D
 * @role BINDING
 *
 * Godot 4.7's `Label3D` (`scene/3d/label_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Mesh`: its text is shaped in the
 * default theme font by compat's text server (`font.ts`) and broken into lines with the autowrap
 * mode's flags at its `width` (`_shape`, `label_3d.cpp:454`); each line is placed by the alignments,
 * `offset` and `line_spacing`, in `pixel_size` world units per font pixel, with Godot's AABB
 * (`get_aabb`), recomputed where Godot recomputes it, in a deferred call after a change
 * (`_queue_update`). The mesh is one quad over that AABB whose texture is the page drawing each
 * glyph at the position Godot places it, in the same font, `modulate` and outline; the glyph
 * rasterization is the browser's. The material is unshaded and transparent, double-sided and
 * depth-tested by the draw flags. Billboards, fixed size, alpha cut modes, `uppercase`,
 * `FILL` justification, right-to-left text and a font other than the default are not bound.
 */

import { DoubleSide, FrontSide, type Mesh, MeshBasicMaterial, PlaneGeometry, CanvasTexture as ThreeCanvasTexture, SRGBColorSpace } from 'three';
import { construct as color, type Color } from './color';
import {
  godot_font_autowrap_flags,
  godot_font_default,
  godot_font_line_breaks,
  godot_font_shape,
  godot_font_substr,
  godot_font_width,
  type ShapedText,
} from './font';
import { godot_node_entity } from './node';
import { godot_message_queue_push } from './object';
import { godot_visual_instance_3d_aabb } from './visual-instance-3d';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;

/** `Label3D::DrawFlags` (`label_3d.h:44`). */
const FLAG_DOUBLE_SIDED = 1;
const FLAG_DISABLE_DEPTH_TEST = 2;
const FLAG_MAX = 4;

interface Label3DState {
  text: string;
  fontSize: number;
  pixelSize: number;
  offset: Vector2;
  lineSpacing: number;
  width: number;
  autowrapMode: number;
  horizontalAlignment: number;
  verticalAlignment: number;
  modulate: Color;
  outlineModulate: Color;
  outlineSize: number;
  billboard: number;
  flags: boolean[];
  pending: boolean;
  aabb: { position: Vector3; size: Vector3 };
  lines: readonly ShapedText[];
}

const LABELS = new WeakMap<Mesh, Label3DState>();

function stateOf(self: object, member: string): Label3DState {
  const state = LABELS.get(godot_node_entity(self) as Mesh);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Label3D`);
  return state;
}

/** `AABB::expand_to` (`core/math/aabb.cpp:180`) in single precision. */
function expandTo(aabb: { position: Vector3; size: Vector3 }, x: number, y: number, z: number): void {
  const begin = [aabb.position.x, aabb.position.y, aabb.position.z];
  const end = [f32(aabb.position.x + aabb.size.x), f32(aabb.position.y + aabb.size.y), f32(aabb.position.z + aabb.size.z)];
  [x, y, z].forEach((value, axis) => {
    if (value < (begin[axis] as number)) begin[axis] = value;
    if (value > (end[axis] as number)) end[axis] = value;
  });
  aabb.position = vector3(begin[0] as number, begin[1] as number, begin[2] as number);
  aabb.size = vector3(f32((end[0] as number) - (begin[0] as number)), f32((end[1] as number) - (begin[1] as number)), f32((end[2] as number) - (begin[2] as number)));
}

const isEmpty = (aabb: { position: Vector3; size: Vector3 }): boolean =>
  [aabb.position.x, aabb.position.y, aabb.position.z, aabb.size.x, aabb.size.y, aabb.size.z].every((value) => value === 0);

/** `shaped_text_get_size(line).y` (`text_server_adv.cpp:7786`): the ascent plus descent, rounded up. */
const lineHeight = (line: ShapedText): number => Math.ceil(line.ascent + line.descent);

/**
 * `_shape` (`label_3d.cpp:454`): the lines at `width` by the autowrap flags, then each line's place
 * and the AABB they cover, in world units; returns each line's origin (its top-left) and baseline.
 */
function shape(state: Label3DState): { readonly x: number; readonly top: number; readonly baseline: number; readonly line: ShapedText }[] {
  const font = godot_font_default();
  const shaped = godot_font_shape(font, state.text, state.fontSize);
  const breaks = godot_font_line_breaks(shaped, state.width, godot_font_autowrap_flags(state.autowrapMode));
  const lines: ShapedText[] = [];
  for (let i = 0; i < breaks.length; i += 2) lines.push(godot_font_substr(shaped, breaks[i] as number, breaks[i + 1] as number));
  state.lines = lines;
  const px = state.pixelSize;
  let totalH = 0;
  for (const line of lines) totalH = f32(totalH + f32(f32(lineHeight(line) + state.lineSpacing) * px));
  let vbegin = 0;
  if (state.verticalAlignment === 1) vbegin = f32(f32(totalH - f32(state.lineSpacing * px)) / 2);
  else if (state.verticalAlignment === 2) vbegin = f32(totalH - f32(state.lineSpacing * px));
  let offsetY = f32(vbegin + f32(state.offset.y * px));
  const placed: { x: number; top: number; baseline: number; line: ShapedText }[] = [];
  state.aabb = { position: vector3(), size: vector3() };
  for (const line of lines) {
    // `shaped_text_get_width` (`text_server_adv.cpp:7823`): the advances summed, rounded up.
    const lineWidth = f32(Math.ceil(godot_font_width(line.glyphs)) * px);
    let offsetX = 0;
    if (state.horizontalAlignment === 1 || state.horizontalAlignment === 3) offsetX = f32(-lineWidth / 2);
    else if (state.horizontalAlignment === 2) offsetX = -lineWidth;
    offsetX = f32(offsetX + f32(state.offset.x * px));
    const bottom = f32(offsetY - f32(f32(lineHeight(line) + state.lineSpacing) * px));
    if (isEmpty(state.aabb)) {
      state.aabb = { position: vector3(offsetX, offsetY, 0), size: vector3() };
      expandTo(state.aabb, f32(offsetX + lineWidth), bottom, 0);
    } else {
      expandTo(state.aabb, offsetX, offsetY, 0);
      expandTo(state.aabb, f32(offsetX + lineWidth), bottom, 0);
    }
    const top = offsetY;
    // `shaped_text_get_ascent`/`_descent` are doubles: the step is taken in double, then stored.
    offsetY = f32(offsetY - line.ascent * px);
    placed.push({ x: offsetX, top, baseline: offsetY, line });
    offsetY = f32(offsetY - (line.descent + state.lineSpacing) * px);
  }
  return placed;
}

const css = (c: Color): string => `rgba(${String(Math.round(c.r * 255))}, ${String(Math.round(c.g * 255))}, ${String(Math.round(c.b * 255))}, ${String(c.a)})`;

/**
 * The quad and its texture: the page draws each glyph where `_generate_glyph_surfaces`
 * (`label_3d.cpp:334`) puts it, the outline under the text.
 */
function draw(mesh: Mesh, state: Label3DState, placed: ReturnType<typeof shape>): void {
  const px = state.pixelSize;
  const margin = state.outlineSize;
  const width = Math.max(1, Math.ceil(state.aabb.size.x / px) + margin * 2);
  const height = Math.max(1, Math.ceil(state.aabb.size.y / px) + margin * 2);
  const topEdge = state.aabb.position.y + state.aabb.size.y;
  mesh.geometry.dispose();
  const geometry = new PlaneGeometry(width * px, height * px);
  geometry.translate(state.aabb.position.x - margin * px + (width * px) / 2, topEdge + margin * px - (height * px) / 2, 0);
  mesh.geometry = geometry;
  const material = mesh.material as MeshBasicMaterial;
  material.side = state.flags[FLAG_DOUBLE_SIDED] === true ? DoubleSide : FrontSide;
  material.depthTest = state.flags[FLAG_DISABLE_DEPTH_TEST] !== true;
  material.transparent = true;
  const page = (globalThis as { readonly document?: Document }).document;
  if (page === undefined) return;
  const canvas = page.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.font = `${String(state.fontSize)}px godot-default-font`;
  context.textBaseline = 'alphabetic';
  for (const pass of [0, 1]) {
    if (pass === 0 && (state.outlineSize <= 0 || state.outlineModulate.a === 0)) continue;
    for (const { x, baseline, line } of placed) {
      let pen = (x - state.aabb.position.x) / px + margin;
      const y = (topEdge - baseline) / px + margin;
      for (const glyph of line.glyphs) {
        const text = String.fromCodePoint(...line.text.slice(glyph.start, glyph.end));
        if (glyph.index !== 0 && glyph.count > 0) {
          if (pass === 0) {
            context.strokeStyle = css(state.outlineModulate);
            context.lineWidth = state.outlineSize / 2;
            context.lineJoin = 'round';
            context.strokeText(text, pen, y);
          } else {
            context.fillStyle = css(state.modulate);
            context.fillText(text, pen, y);
          }
        }
        pen += glyph.advance;
      }
    }
  }
  material.map?.dispose();
  const texture = new ThreeCanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  material.map = texture;
  material.needsUpdate = true;
}

function update(mesh: Mesh, state: Label3DState): void {
  state.pending = false;
  draw(mesh, state, shape(state));
}

/** `_queue_update` (`label_3d.cpp:237`): one deferred update after changes. */
function queue(mesh: Mesh, state: Label3DState): void {
  if (state.pending) return;
  state.pending = true;
  godot_message_queue_push(mesh, () => update(mesh, state));
}

/**
 * Makes `entity` a Label3D with its defaults (`label_3d.h:66-110`): text empty, size 32, pixel
 * size 0.005, width 500, centred, white, a 12-pixel black outline, double-sided; the first update
 * queued as it is created.
 *
 * @godot Label3D (protocol)
 * @source scene/3d/label_3d.cpp:1082
 */
export function godot_label_3d_mount(entity: Mesh): void {
  const state: Label3DState = {
    text: '',
    fontSize: 32,
    pixelSize: f32(0.005),
    offset: vector2(),
    lineSpacing: 0,
    width: 500,
    autowrapMode: 0,
    horizontalAlignment: 1,
    verticalAlignment: 1,
    modulate: color(1, 1, 1, 1),
    outlineModulate: color(0, 0, 0, 1),
    outlineSize: 12,
    billboard: 0,
    flags: Array.from({ length: FLAG_MAX }, (_, flag) => flag === FLAG_DOUBLE_SIDED),
    pending: false,
    aabb: { position: vector3(), size: vector3() },
    lines: [],
  };
  LABELS.set(entity, state);
  entity.material = new MeshBasicMaterial({ transparent: true, side: DoubleSide });
  entity.geometry = new PlaneGeometry(0, 0);
  godot_visual_instance_3d_aabb(entity, () => state.aabb);
  queue(entity, state);
}

function setter<K extends keyof Label3DState>(key: K, member: string) {
  return (self: object, value: Label3DState[K]): void => {
    const state = stateOf(self, member);
    if (state[key] === value) return;
    state[key] = value;
    queue(godot_node_entity(self) as Mesh, state);
  };
}

/**
 * @godot Label3D.set_text
 * @source scene/3d/label_3d.cpp:664
 */
export function set_text(self: object, text: string): void {
  setter('text', 'set_text')(self, text);
}

/**
 * @godot Label3D.get_text
 * @source scene/3d/label_3d.cpp:675
 */
export function get_text(self: object): string {
  return stateOf(self, 'get_text').text;
}

/**
 * A size under 1 fails (`ERR_FAIL_COND(p_size <= 0)`).
 *
 * @godot Label3D.set_font_size
 * @source scene/3d/label_3d.cpp:863
 */
export function set_font_size(self: object, size: number): void {
  if (size <= 0) return;
  setter('fontSize', 'set_font_size')(self, Math.trunc(size));
}

/**
 * @godot Label3D.get_font_size
 * @source scene/3d/label_3d.cpp:871
 */
export function get_font_size(self: object): number {
  return stateOf(self, 'get_font_size').fontSize;
}

/**
 * @godot Label3D.set_pixel_size
 * @source scene/3d/label_3d.cpp:956
 */
export function set_pixel_size(self: object, size: number): void {
  setter('pixelSize', 'set_pixel_size')(self, f32(size));
}

/**
 * @godot Label3D.get_pixel_size
 * @source scene/3d/label_3d.cpp:963
 */
export function get_pixel_size(self: object): number {
  return stateOf(self, 'get_pixel_size').pixelSize;
}

/**
 * @godot Label3D.set_offset
 * @source scene/3d/label_3d.cpp:967
 */
export function set_offset(self: object, offset: Vector2): void {
  const state = stateOf(self, 'set_offset');
  state.offset = offset;
  queue(godot_node_entity(self) as Mesh, state);
}

/**
 * @godot Label3D.get_offset
 * @source scene/3d/label_3d.cpp:974
 */
export function get_offset(self: object): Vector2 {
  return stateOf(self, 'get_offset').offset;
}

/**
 * @godot Label3D.set_line_spacing
 * @source scene/3d/label_3d.cpp:978
 */
export function set_line_spacing(self: object, spacing: number): void {
  setter('lineSpacing', 'set_line_spacing')(self, f32(spacing));
}

/**
 * @godot Label3D.get_line_spacing
 * @source scene/3d/label_3d.cpp:985
 */
export function get_line_spacing(self: object): number {
  return stateOf(self, 'get_line_spacing').lineSpacing;
}

/**
 * @godot Label3D.set_width
 * @source scene/3d/label_3d.cpp:944
 */
export function set_width(self: object, width: number): void {
  setter('width', 'set_width')(self, f32(width));
}

/**
 * @godot Label3D.get_width
 * @source scene/3d/label_3d.cpp:952
 */
export function get_width(self: object): number {
  return stateOf(self, 'get_width').width;
}

/**
 * @godot Label3D.set_autowrap_mode
 * @source scene/3d/label_3d.cpp:908
 */
export function set_autowrap_mode(self: object, mode: number): void {
  setter('autowrapMode', 'set_autowrap_mode')(self, mode);
}

/**
 * @godot Label3D.get_autowrap_mode
 * @source scene/3d/label_3d.cpp:916
 */
export function get_autowrap_mode(self: object): number {
  return stateOf(self, 'get_autowrap_mode').autowrapMode;
}

/**
 * An alignment outside `0..3` fails.
 *
 * @godot Label3D.set_horizontal_alignment
 * @source scene/3d/label_3d.cpp:679
 */
export function set_horizontal_alignment(self: object, alignment: number): void {
  if (alignment < 0 || alignment >= 4) return;
  setter('horizontalAlignment', 'set_horizontal_alignment')(self, alignment);
}

/**
 * @godot Label3D.get_horizontal_alignment
 * @source scene/3d/label_3d.cpp:690
 */
export function get_horizontal_alignment(self: object): number {
  return stateOf(self, 'get_horizontal_alignment').horizontalAlignment;
}

/**
 * An alignment outside `0..3` fails.
 *
 * @godot Label3D.set_vertical_alignment
 * @source scene/3d/label_3d.cpp:694
 */
export function set_vertical_alignment(self: object, alignment: number): void {
  if (alignment < 0 || alignment >= 4) return;
  setter('verticalAlignment', 'set_vertical_alignment')(self, alignment);
}

/**
 * @godot Label3D.get_vertical_alignment
 * @source scene/3d/label_3d.cpp:702
 */
export function get_vertical_alignment(self: object): number {
  return stateOf(self, 'get_vertical_alignment').verticalAlignment;
}

/**
 * @godot Label3D.set_modulate
 * @source scene/3d/label_3d.cpp:886
 */
export function set_modulate(self: object, modulate: Color): void {
  const state = stateOf(self, 'set_modulate');
  state.modulate = modulate;
  queue(godot_node_entity(self) as Mesh, state);
}

/**
 * @godot Label3D.get_modulate
 * @source scene/3d/label_3d.cpp:893
 */
export function get_modulate(self: object): Color {
  return stateOf(self, 'get_modulate').modulate;
}

/**
 * @godot Label3D.set_outline_modulate
 * @source scene/3d/label_3d.cpp:897
 */
export function set_outline_modulate(self: object, modulate: Color): void {
  const state = stateOf(self, 'set_outline_modulate');
  state.outlineModulate = modulate;
  queue(godot_node_entity(self) as Mesh, state);
}

/**
 * @godot Label3D.get_outline_modulate
 * @source scene/3d/label_3d.cpp:904
 */
export function get_outline_modulate(self: object): Color {
  return stateOf(self, 'get_outline_modulate').outlineModulate;
}

/**
 * A negative size fails (`ERR_FAIL_COND(p_size < 0)`).
 *
 * @godot Label3D.set_outline_size
 * @source scene/3d/label_3d.cpp:875
 */
export function set_outline_size(self: object, size: number): void {
  if (size < 0) return;
  setter('outlineSize', 'set_outline_size')(self, Math.trunc(size));
}

/**
 * @godot Label3D.get_outline_size
 * @source scene/3d/label_3d.cpp:882
 */
export function get_outline_size(self: object): number {
  return stateOf(self, 'get_outline_size').outlineSize;
}

/**
 * A flag outside `0..3` fails.
 *
 * @godot Label3D.set_draw_flag
 * @source scene/3d/label_3d.cpp:989
 */
export function set_draw_flag(self: object, flag: number, enabled: boolean): void {
  if (flag < 0 || flag >= FLAG_MAX) return;
  const state = stateOf(self, 'set_draw_flag');
  if (state.flags[flag] === enabled) return;
  state.flags[flag] = enabled;
  queue(godot_node_entity(self) as Mesh, state);
}

/**
 * @godot Label3D.get_draw_flag
 * @source scene/3d/label_3d.cpp:997
 */
export function get_draw_flag(self: object, flag: number): boolean {
  if (flag < 0 || flag >= FLAG_MAX) return false;
  return stateOf(self, 'get_draw_flag').flags[flag] === true;
}

/**
 * A mode outside `0..2` fails; billboards are stored, not drawn.
 *
 * @godot Label3D.set_billboard_mode
 * @source scene/3d/label_3d.cpp:1002
 */
export function set_billboard_mode(self: object, mode: number): void {
  if (mode < 0 || mode >= 3) return;
  setter('billboard', 'set_billboard_mode')(self, mode);
}

/**
 * @godot Label3D.get_billboard_mode
 * @source scene/3d/label_3d.cpp:1010
 */
export function get_billboard_mode(self: object): number {
  return stateOf(self, 'get_billboard_mode').billboard;
}
