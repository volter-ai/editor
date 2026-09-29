/**
 * @godot-class StyleBox
 * @role PROTOCOL
 *
 * Godot 4.7's `StyleBox` (`scene/resources/style_box.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a box a Control draws behind its content, with the
 * margins its content keeps from the box's edges: each side's content margin where set (not
 * negative), else the box's own (`StyleBox::get_margin`, `style_box.cpp:78`). Each kind of box
 * paints itself as CSS on the element that stands for it (`style-box-flat.ts`, `style-box-line.ts`).
 */

/** How one kind of box paints an element and what margin it keeps on each side. */
export interface GodotStyleBoxPainter {
  /** `get_style_margin` of a side (`SIDE_LEFT` 0 … `SIDE_BOTTOM` 3). */
  readonly styleMargin: (side: number) => number;
  /** Paints the box over the whole of `layer`, an element the size of the rect it is drawn in. */
  readonly paint: (layer: HTMLElement) => void;
  /** What the painting depends on, to repaint only when it changes. */
  readonly key: () => string;
}

export interface StyleBox {
  /** `content_margin` per side; -1 (the default) defers to the box's own margin. */
  readonly contentMargin: number[];
}

const PAINTERS = new WeakMap<object, GodotStyleBoxPainter>();

/**
 * A new box's content margins, with the painter of its kind.
 *
 * @godot StyleBox (protocol)
 * @source scene/resources/style_box.cpp:141
 */
export function godot_style_box_new(painter: GodotStyleBoxPainter, properties: Readonly<Record<string, unknown>> = {}): StyleBox {
  const box: StyleBox = {
    contentMargin: ['left', 'top', 'right', 'bottom'].map((side) => (typeof properties[`content_margin_${side}`] === 'number' ? (properties[`content_margin_${side}`] as number) : -1)),
  };
  PAINTERS.set(box, painter);
  return box;
}

/**
 * @godot StyleBox.set_content_margin
 * @source scene/resources/style_box.cpp:50
 */
export function set_content_margin(self: StyleBox, side: number, value: number): void {
  self.contentMargin[side] = value;
}

/**
 * @godot StyleBox.get_content_margin
 * @source scene/resources/style_box.cpp:72
 */
export function get_content_margin(self: StyleBox, side: number): number {
  return self.contentMargin[side] ?? -1;
}

/**
 * @godot StyleBox.set_content_margin_all
 * @source scene/resources/style_box.cpp:57
 */
export function set_content_margin_all(self: StyleBox, value: number): void {
  for (let side = 0; side < 4; side += 1) self.contentMargin[side] = value;
}

/**
 * @godot StyleBox.get_margin
 * @source scene/resources/style_box.cpp:78
 */
export function get_margin(self: StyleBox, side: number): number {
  const content = self.contentMargin[side] ?? -1;
  return content < 0 ? (PAINTERS.get(self)?.styleMargin(side) ?? 0) : content;
}

/**
 * Paints the box over `layer`, and what it painted from.
 *
 * @godot StyleBox (protocol)
 * @source scene/resources/style_box.cpp:92
 */
export function godot_style_box_paint(self: StyleBox, layer: HTMLElement): void {
  PAINTERS.get(self)?.paint(layer);
}

/**
 * @godot StyleBox (protocol)
 * @source scene/resources/style_box.cpp:92
 */
export function godot_style_box_key(self: StyleBox): string {
  return `${JSON.stringify(self.contentMargin)}${PAINTERS.get(self)?.key() ?? ''}`;
}

/**
 * A CSS colour of a Godot colour (sRGB components, alpha).
 *
 * @godot StyleBox (protocol)
 * @source scene/resources/style_box.cpp:92
 */
export function godot_style_box_css_color(color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number }): string {
  const channel = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255);
  return `rgba(${String(channel(color.r))}, ${String(channel(color.g))}, ${String(channel(color.b))}, ${String(Math.min(Math.max(color.a, 0), 1))})`;
}
