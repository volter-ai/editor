/**
 * @godot-class Label3D
 * @role BINDING
 *
 * Godot 4.7's `Label3D` (`scene/3d/label_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Mesh` textured with a 2D canvas the
 * browser draws the text on: the text in the default theme font (`font.ts`), wrapped by the
 * autowrap mode at `width`, each line placed by the alignments, `offset` and `line_spacing`, in
 * `pixel_size` world units per font pixel. The mesh is one quad over the lines' box, redrawn in a
 * deferred call after a change (`_queue_update`), filled with `modulate` over an outline stroked in
 * `outline_modulate`; its box is the node's AABB. The material is unshaded and transparent,
 * double-sided and depth-tested by the draw flags. Billboards, fixed size, alpha cut modes,
 * `uppercase`, right-to-left text and a font other than the default are not bound.
 */

import { DoubleSide, FrontSide, type Mesh, MeshBasicMaterial, PlaneGeometry, CanvasTexture as ThreeCanvasTexture, SRGBColorSpace } from 'three';
import { construct as color, type Color } from './color';
import { get_ascent, get_height, godot_font_css, godot_font_default, godot_font_measure, godot_font_wrap } from './font';
import { godot_node_entity } from './node';
import { godot_message_queue_push } from './object';
import { godot_visual_instance_3d_aabb } from './visual-instance-3d';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';
import type { ReactElement } from 'react';
import { Mesh as ThreeMesh } from 'three';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

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
}

const LABELS = new WeakMap<Mesh, Label3DState>();

function stateOf(self: object, member: string): Label3DState {
  const state = LABELS.get(godot_node_entity(self) as Mesh);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Label3D`);
  return state;
}

const css = (c: Color): string => `rgba(${String(Math.round(c.r * 255))}, ${String(Math.round(c.g * 255))}, ${String(Math.round(c.b * 255))}, ${String(c.a)})`;

interface PlacedLine {
  readonly text: string;
  /** The line's left edge and baseline in the texture, in font pixels. */
  readonly x: number;
  readonly baseline: number;
}

/** The text's lines placed in font pixels, and the box they cover in world units (`_shape`, `label_3d.cpp:454`). */
function shape(state: Label3DState): { readonly lines: readonly PlacedLine[]; readonly width: number; readonly height: number } {
  const font = godot_font_default();
  const size = state.fontSize;
  const texts = state.text.split('\n').flatMap((paragraph) => (state.autowrapMode === 0 ? [paragraph] : godot_font_wrap(font, paragraph, size, state.width, state.autowrapMode)));
  const lineH = Math.ceil(get_height(font, size));
  const ascent = get_ascent(font, size);
  const widths = texts.map((text) => Math.ceil(godot_font_measure(font, text, size)));
  const width = Math.max(0, ...widths);
  const height = texts.length * (lineH + state.lineSpacing) - state.lineSpacing;
  const lines = texts.map((text, i) => {
    const free = width - (widths[i] as number);
    const x = state.horizontalAlignment === 1 || state.horizontalAlignment === 3 ? free / 2 : state.horizontalAlignment === 2 ? free : 0;
    return { text, x, baseline: i * (lineH + state.lineSpacing) + ascent };
  });
  return { lines, width, height };
}

/**
 * Places the quad by the alignments and `offset` (the horizontal alignment picks which edge of the
 * text sits at the origin, the vertical which of top, middle or bottom), and draws the text on its
 * texture, the outline under the fill.
 */
function draw(mesh: Mesh, state: Label3DState, text: ReturnType<typeof shape>): void {
  const px = state.pixelSize;
  const margin = state.outlineSize;
  const left = state.horizontalAlignment === 1 || state.horizontalAlignment === 3 ? -text.width / 2 : state.horizontalAlignment === 2 ? -text.width : 0;
  const top = state.verticalAlignment === 1 ? text.height / 2 : state.verticalAlignment === 2 ? text.height : 0;
  const x0 = (left + state.offset.x) * px;
  const y0 = (top + state.offset.y) * px;
  state.aabb = { position: vector3(x0, y0 - text.height * px, 0), size: vector3(text.width * px, text.height * px, 0) };
  const width = Math.max(1, Math.ceil(text.width) + margin * 2);
  const height = Math.max(1, Math.ceil(text.height) + margin * 2);
  mesh.geometry.dispose();
  const geometry = new PlaneGeometry(width * px, height * px);
  geometry.translate(x0 - margin * px + (width * px) / 2, y0 + margin * px - (height * px) / 2, 0);
  mesh.geometry = geometry;
  const material = mesh.material as MeshBasicMaterial;
  material.side = state.flags[FLAG_DOUBLE_SIDED] === true ? DoubleSide : FrontSide;
  material.depthTest = state.flags[FLAG_DISABLE_DEPTH_TEST] !== true;
  material.transparent = true;
  if (typeof OffscreenCanvas !== 'function') return;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.font = godot_font_css(godot_font_default(), state.fontSize);
  context.textBaseline = 'alphabetic';
  context.lineJoin = 'round';
  context.lineWidth = state.outlineSize / 2;
  context.strokeStyle = css(state.outlineModulate);
  context.fillStyle = css(state.modulate);
  const outlined = state.outlineSize > 0 && state.outlineModulate.a > 0;
  if (outlined) for (const line of text.lines) context.strokeText(line.text, line.x + margin, line.baseline + margin);
  for (const line of text.lines) context.fillText(line.text, line.x + margin, line.baseline + margin);
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

const LABEL_3D = {
  create: () => new ThreeMesh(),
  classes: ['Label3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: godot_label_3d_mount,
  props: new Map<string, GodotElementProp<Mesh>>([
    ['pixelSize', (entity, value: number) => set_pixel_size(entity, value)],
    ['offset', (entity, value: readonly [number, number]) => set_offset(entity, vector2(...value))],
    ['billboard', (entity, value: number) => set_billboard_mode(entity, value)],
    ['shaded', (entity, value: boolean) => set_draw_flag(entity, 0, value)],
    ['doubleSided', (entity, value: boolean) => set_draw_flag(entity, 1, value)],
    ['noDepthTest', (entity, value: boolean) => set_draw_flag(entity, 2, value)],
    ['fixedSize', (entity, value: boolean) => set_draw_flag(entity, 3, value)],
    ['modulate', (entity, value: readonly [number, number, number, number]) => set_modulate(entity, color(...value))],
    ['outlineModulate', (entity, value: readonly [number, number, number, number]) => set_outline_modulate(entity, color(...value))],
    ['text', (entity, value: string) => set_text(entity, value)],
    ['fontSize', (entity, value: number) => set_font_size(entity, value)],
    ['outlineSize', (entity, value: number) => set_outline_size(entity, value)],
    ['horizontalAlignment', (entity, value: number) => set_horizontal_alignment(entity, value)],
    ['verticalAlignment', (entity, value: number) => set_vertical_alignment(entity, value)],
    ['lineSpacing', (entity, value: number) => set_line_spacing(entity, value)],
    ['autowrapMode', (entity, value: number) => set_autowrap_mode(entity, value)],
    ['width', (entity, value: number) => set_width(entity, value)],
  ]),
};

/**
 * A Label3D as a scene writes it: `<GodotLabel3D text="…" fontSize={48} />`, its transform three's.
 *
 * @godot Label3D (protocol)
 * @source scene/3d/label_3d.cpp:135
 */
export function GodotLabel3D(props: GodotElementProps<Mesh>): ReactElement {
  return useGodotElement(LABEL_3D, props);
}
