/**
 * A Control as the React DOM element its scene renders (docs/GODOT.md §The lane's law, "UI is React
 * DOM"): the element's tag, its style computed from Godot's layout rules (anchors and offsets, a
 * container's placement of its children, the theme's and the node's own styleboxes and fonts), its
 * text and the Godot-only state its `data-*` attributes carry. What the idiom table
 * (`scene-node-idioms.ts`) says of the class, its tag, the layout it gives its children and what it
 * draws, is the only thing read of it; a property this plan does not turn into the element refuses
 * the scene by name.
 */
import type { DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';
import type { GodotSceneNodeIdiomForm } from './scene-node-idioms';
import { godotSceneSubnodes, type TargetGodotSceneResourcePlan, type TargetGodotSceneSetterPlan, type TargetGodotSceneValue } from './scene-document-plan';
import { godotImportedAssetUrl } from './code-resource-loads';

type SceneWithoutRefs = Omit<DirectGodotSceneDocumentPlan, 'refs'>;
type DomForm = Extract<GodotSceneNodeIdiomForm, { readonly kind: 'dom' }>;

/**
 * A style value: CSS as written, a font resource's family (`font.ts`), which the scene reads from
 * the resource, or `display` shown only on a touch screen (`DisplayServer.is_touchscreen_available`).
 */
export type GodotControlStyleValue = string | number | { readonly fontFamily: string } | { readonly touchscreenOnly: true };

/** The element a Control renders, as the plan computes it. */
export interface GodotControlDomPlan {
  readonly tag: string;
  readonly style: Readonly<Record<string, GodotControlStyleValue>>;
  /** Its HTML attributes (an image's `src`, a range's bounds, a checkbox's state). */
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  /** The Godot-only state the Node protocol reads (`data-name`, `data-classes`, `data-groups`, …). */
  readonly data: Readonly<Record<string, string>>;
  /** Its text, before its children (a Label's, a Button's). */
  readonly text?: string;
  /** Elements it draws before its children (a CheckBox's box, a progress bar's textures). */
  readonly parts?: readonly GodotControlPartPlan[];
  /** An AnimationPlayer's animations as Web Animations keyframes, and the one it plays as it enters. */
  readonly animations?: GodotControlAnimationsPlan;
  /**
   * React events and the compat call each makes with literal arguments (a touch button's action),
   * the React event first where `event` says so.
   */
  readonly events?: Readonly<Record<string, { readonly module: string; readonly exportName: string; readonly args: readonly (string | number | boolean)[]; readonly event?: true }>>;
}

/**
 * An AnimationPlayer's animations among Controls (`animation-player.ts`): each value track as
 * keyframes of a CSS property of the element at its path from the player's root node, played for
 * the animation's length, looping as it loops (`Animation::LoopMode`: none, linear, ping-pong).
 */
export interface GodotControlAnimationsPlan {
  readonly root: string;
  readonly autoplay?: string;
  readonly animations: readonly {
    readonly name: string;
    readonly length: number;
    readonly loop: number;
    readonly tracks: readonly { readonly path: string; readonly keyframes: readonly Readonly<Record<string, string | number>>[] }[];
  }[];
}

/** An element a Control draws inside itself, which is not a node. */
export interface GodotControlPartPlan {
  readonly tag: string;
  readonly style: Readonly<Record<string, GodotControlStyleValue>>;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  /** What compat finds it by, to change it (`data-part`). */
  readonly part?: string;
}

/** Godot's default theme (`scene/theme/default_theme.cpp`): the values a Control draws with unless its scene overrides them. */
const THEME = {
  fontSize: 16,
  labelColor: [1, 1, 1, 1],
  controlFontColor: [0.875, 0.875, 0.875, 1],
  separation: 4,
  // `make_flat_stylebox(style_normal_color)`: a button's normal stylebox, 4 px margins, 3 px corners.
  buttonBackground: [0.1, 0.1, 0.1, 0.6],
  buttonMargin: 4,
  cornerRadius: 3,
  // PanelContainer's `panel`: `make_flat_stylebox(style_normal_color, 0, 0, 0, 0)`.
  panelBackground: [0.1, 0.1, 0.1, 0.6],
  separatorColor: [0.5, 0.5, 0.5, 1],
  checkSeparation: 4,
} as const;

/** `SIDE_LEFT`, `SIDE_TOP`, `SIDE_RIGHT`, `SIDE_BOTTOM`. */
const SIDES = ['left', 'top', 'right', 'bottom'] as const;

/** `Control::SizeFlags`. */
const SIZE_FILL = 1;
const SIZE_EXPAND = 2;
const SIZE_SHRINK_CENTER = 4;
const SIZE_SHRINK_END = 8;

/** A colour as CSS, its channels 0..1 as Godot keeps them. */
function css(color: readonly number[]): string {
  const [r = 0, g = 0, b = 0, a = 1] = color;
  const byte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255);
  return `rgba(${String(byte(r))}, ${String(byte(g))}, ${String(byte(b))}, ${String(Math.round(a * 1000) / 1000)})`;
}

const px = (value: number) => `${String(Math.round(value * 1000) / 1000)}px`;

/** `calc(<share> * 100% + <offset>px)`, as short as it can be written. */
function calc(share: number, offset: number): string {
  if (share === 0) return px(offset);
  const percent = `${String(Math.round(share * 100000) / 1000)}%`;
  if (offset === 0) return percent;
  return `calc(${percent} ${offset < 0 ? '-' : '+'} ${px(Math.abs(offset))})`;
}

/** The properties a Control states, by Godot name (a side's own under `name:side`). */
class Stated {
  readonly #values = new Map<string, TargetGodotSceneValue>();
  readonly #used = new Set<string>();
  constructor(setters: readonly TargetGodotSceneSetterPlan[]) {
    for (const setter of setters) this.#values.set(setter.propertyName, setter.value);
  }
  get(name: string): TargetGodotSceneValue | undefined {
    this.#used.add(name);
    return this.#values.get(name);
  }
  number(name: string, fallback: number): number {
    const value = this.get(name);
    return value?.kind === 'number' ? value.value : fallback;
  }
  bool(name: string, fallback: boolean): boolean {
    const value = this.get(name);
    return value?.kind === 'bool' ? value.value : fallback;
  }
  string(name: string): string | undefined {
    const value = this.get(name);
    return value?.kind === 'string' ? value.value : undefined;
  }
  components(name: string): readonly number[] | undefined {
    const value = this.get(name);
    return value !== undefined && 'components' in value ? value.components : undefined;
  }
  resource(name: string): string | undefined {
    const value = this.get(name);
    return value?.kind === 'resource' ? value.key : undefined;
  }
  /** Every stated name. */
  names(): readonly string[] {
    return [...this.#values.keys()];
  }
  /** The stated names nothing read. */
  unread(): readonly string[] {
    return [...this.#values.keys()].filter((name) => !this.#used.has(name));
  }
}

/** The properties a Control states that change nothing drawn or kept on the page. */
const INERT = new Set([
  // The editor's own layout bookkeeping: the anchors and offsets are stated beside them.
  'layout_mode',
  'anchors_preset',
  'metadata/_edit_use_anchors_',
  'metadata/_edit_group_',
  'metadata/_edit_lock_',
  // Scroll events a Control passes on, which the page's elements pass anyway.
  'mouse_force_pass_scroll_events',
  // Focus and tooltips the page's own elements give.
  'focus_mode',
  'tooltip_text',
]);

/** The properties CanvasItem and Node give every Control, read here or by the Node protocol. */
function canvasItemStyle(stated: Stated, style: Record<string, GodotControlStyleValue>, ownColor: boolean): void {
  // `visible` hides the element once its layout is known (`godotControlDom`).
  stated.get('visible');
  // `modulate` multiplies the item and its children, `self_modulate` the item alone: the page's
  // opacity; a colour tint has no CSS of its own and is refused.
  for (const name of ownColor ? ['modulate'] : ['modulate', 'self_modulate']) {
    const color = stated.components(name);
    if (color === undefined) continue;
    const [r = 1, g = 1, b = 1, a = 1] = color;
    if (r !== 1 || g !== 1 || b !== 1) throw new Error(`a Control's ${name} tint has no CSS form`);
    if (a !== 1) style['opacity'] = Math.round(a * 1000) / 1000;
  }
  const z = stated.number('z_index', 0);
  if (z !== 0) style['zIndex'] = z;
  stated.bool('z_as_relative', true);
  // A texture filter or repeat changes how an image is sampled: the page's own image rendering.
  const filter = stated.number('texture_filter', 0);
  if (filter === 1 || filter === 3 || filter === 5) style['imageRendering'] = 'pixelated';
}

/** The anchors and offsets of a Control its parent does not place: an absolutely placed box. */
function anchoredStyle(stated: Stated, style: Record<string, GodotControlStyleValue>): void {
  const anchor = SIDES.map((side) => stated.number(`anchor_${side}`, 0));
  const offset = SIDES.map((side) => stated.number(`offset_${side}`, 0));
  const [aLeft, aTop, aRight, aBottom] = anchor as [number, number, number, number];
  const [oLeft, oTop, oRight, oBottom] = offset as [number, number, number, number];
  style['position'] = 'absolute';
  // A box smaller than its minimum grows by its grow direction (`Control::_compute_offsets`):
  // toward its end from its begin, or from its end toward its begin.
  const horizontal = stated.number('grow_horizontal', 1);
  const vertical = stated.number('grow_vertical', 1);
  if (horizontal === 0) style['right'] = calc(1 - aRight, -oRight);
  else style['left'] = calc(aLeft, oLeft);
  style['width'] = calc(aRight - aLeft, oRight - oLeft);
  if (vertical === 0) style['bottom'] = calc(1 - aBottom, -oBottom);
  else style['top'] = calc(aTop, oTop);
  style['height'] = calc(aBottom - aTop, oBottom - oTop);
}

/**
 * A Node2D among Controls: placed at its position from its parent's top-left, rotated and scaled
 * about that point (`Node2D::get_transform`), as large as what it draws.
 */
function node2dStyle(stated: Stated, style: Record<string, GodotControlStyleValue>): void {
  const position = stated.components('position') ?? [0, 0];
  const rotation = stated.number('rotation', 0);
  const scale = stated.components('scale') ?? [1, 1];
  stated.number('skew', 0);
  style['position'] = 'absolute';
  style['left'] = px(position[0] ?? 0);
  style['top'] = px(position[1] ?? 0);
  if (rotation !== 0) style['rotate'] = `${String(rotation)}rad`;
  if (scale[0] !== 1 || scale[1] !== 1) style['scale'] = `${String(scale[0])} ${String(scale[1])}`;
  style['transformOrigin'] = '0 0';
}

/** How a container parent places this child: a flex item along a row or column, or one of a stack. */
function placedStyle(stated: Stated, layout: DomForm['layout'], style: Record<string, GodotControlStyleValue>): void {
  // Its authored anchors and offsets are the container's to set: they do not place it.
  for (const side of SIDES) {
    stated.get(`anchor_${side}`);
    stated.get(`offset_${side}`);
  }
  stated.get('grow_horizontal');
  stated.get('grow_vertical');
  const horizontal = stated.number('size_flags_horizontal', SIZE_FILL);
  const vertical = stated.number('size_flags_vertical', SIZE_FILL);
  const ratio = stated.number('size_flags_stretch_ratio', 1);
  style['position'] = 'relative';
  const align = (flags: number) =>
    (flags & SIZE_SHRINK_END) !== 0 ? 'end' : (flags & SIZE_SHRINK_CENTER) !== 0 ? 'center' : (flags & SIZE_FILL) !== 0 ? 'stretch' : 'start';
  if (layout === 'row' || layout === 'column') {
    // Along the box: an expanding child shares the room left over by its stretch ratio
    // (`BoxContainer::_resort`), never smaller than its minimum; across it, its flags align it.
    const along = layout === 'row' ? horizontal : vertical;
    const across = layout === 'row' ? vertical : horizontal;
    style['flex'] = (along & SIZE_EXPAND) !== 0 ? `${String(ratio)} 1 0` : '0 0 auto';
    style['alignSelf'] = align(across);
  } else {
    // A stack (MarginContainer, PanelContainer, CenterContainer): every child in the one cell.
    style['gridArea'] = '1 / 1';
    style['justifySelf'] = layout === 'center' ? 'center' : align(horizontal);
    style['alignSelf'] = layout === 'center' ? 'center' : align(vertical);
  }
}

/** The theme overrides a Control states (`theme_override_<kind>s/<name>`), by kind and name. */
function override(stated: Stated, kind: 'colors' | 'constants' | 'font_sizes' | 'fonts' | 'styles', name: string): TargetGodotSceneValue | undefined {
  return stated.get(`theme_override_${kind}/${name}`);
}

/** A StyleBoxFlat's background, border, corners and content margins as CSS. */
function styleBoxStyle(resource: TargetGodotSceneResourcePlan, style: Record<string, GodotControlStyleValue>): void {
  const stated = new Stated(resource.setters);
  const background = stated.components('bg_color') ?? [0.6, 0.6, 0.6, 1];
  if (stated.bool('draw_center', true)) style['background'] = css(background);
  const border = SIDES.map((side) => stated.number(`border_width_${side}`, 0));
  if (border.some((width) => width > 0)) {
    style['borderStyle'] = 'solid';
    style['borderColor'] = css(stated.components('border_color') ?? [0.8, 0.8, 0.8, 1]);
    style['borderWidth'] = border.map(px).join(' ');
  }
  const corners = ['top_left', 'top_right', 'bottom_right', 'bottom_left'].map((corner) => stated.number(`corner_radius_${corner}`, 0));
  if (corners.some((radius) => radius > 0)) style['borderRadius'] = corners.map(px).join(' ');
  // A negative content margin is the stylebox's default, none for a flat one's content.
  const margins = SIDES.map((side) => Math.max(0, stated.number(`content_margin_${side}`, -1)));
  if (margins.some((margin) => margin > 0)) style['padding'] = [margins[1], margins[2], margins[3], margins[0]].map((margin) => px(margin as number)).join(' ');
  const shadow = stated.number('shadow_size', 0);
  if (shadow > 0) {
    const offset = stated.components('shadow_offset') ?? [0, 0];
    style['boxShadow'] = `${px(offset[0] ?? 0)} ${px(offset[1] ?? 0)} ${px(shadow)} ${css(stated.components('shadow_color') ?? [0, 0, 0, 0.6])}`;
  }
  // Anti-aliasing and corner detail are how Godot tessellates the corners; the page draws them round.
  for (const name of ['anti_aliasing', 'anti_aliasing_size', 'corner_detail']) stated.get(name);
  const unread = stated.unread();
  if (unread.length > 0) throw new Error(`StyleBoxFlat's ${unread.join(', ')} has no CSS form`);
}

/** A StyleBoxLine as the rule a separator draws. */
function styleBoxLineStyle(resource: TargetGodotSceneResourcePlan, style: Record<string, GodotControlStyleValue>): void {
  const stated = new Stated(resource.setters);
  const thickness = stated.number('thickness', 1);
  style['borderTop'] = `${px(thickness)} solid ${css(stated.components('color') ?? [0, 0, 0, 1])}`;
  stated.bool('vertical', false);
  // The line grows past (or, negative, stops short of) the separator's ends (`StyleBoxLine::draw`).
  const begin = stated.number('grow_begin', 1);
  const end = stated.number('grow_end', 1);
  style['marginLeft'] = px(-begin);
  style['marginRight'] = px(-end);
  for (const side of SIDES) stated.get(`content_margin_${side}`);
  const unread = stated.unread();
  if (unread.length > 0) throw new Error(`StyleBoxLine's ${unread.join(', ')} has no CSS form`);
}

/**
 * A texture as the page draws it: its CSS image (an imported image's copied file, a
 * GradientTexture2D's gradient, a CanvasTexture without an image as Godot's white texel) and its
 * pixel size.
 */
function textureImage(resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>, key: string): { readonly image: string; readonly size?: readonly [number, number] } {
  const resource = resources.get(key);
  if (resource?.load !== undefined) return { image: `url("${godotImportedAssetUrl(resource.load.sourceResPath)}")`, ...(resource.load.size === undefined ? {} : { size: resource.load.size }) };
  if (resource !== undefined && resource.setters.some((entry) => entry.propertyName === 'gradient')) return gradientImage(resources, resource);
  if (resource !== undefined && resource.setters.every((entry) => entry.propertyName !== 'diffuse_texture') && resource.className === 'CanvasTexture') {
    return { image: 'linear-gradient(white, white)', size: [1, 1] };
  }
  throw new Error(`a Control's ${resource?.className ?? 'unknown'} texture has no image the page loads`);
}

/**
 * A GradientTexture2D as CSS: its Gradient's stops along the line from `fill_from` to `fill_to`
 * (`GradientTexture2D::_update`, `gradient_texture.cpp:216`), linear or radial, at its size.
 */
function gradientImage(resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>, texture: TargetGodotSceneResourcePlan): { readonly image: string; readonly size: readonly [number, number] } {
  const own = new Stated(texture.setters);
  const gradientKey = own.resource('gradient');
  const gradient = gradientKey === undefined ? undefined : resources.get(gradientKey);
  const width = own.number('width', 64);
  const height = own.number('height', 64);
  const fill = own.number('fill', 0);
  const from = own.components('fill_from') ?? [0, 0];
  const to = own.components('fill_to') ?? [1, 0];
  if (own.number('repeat', 0) !== 0) throw new Error('a GradientTexture2D\'s repeat has no CSS form');
  if (fill > 1) throw new Error('a GradientTexture2D\'s square fill has no CSS form');
  const stops: string[] = [];
  if (gradient !== undefined) {
    const values = new Stated(gradient.setters);
    const offsets = values.components('offsets') ?? [0, 1];
    const colors = values.components('colors') ?? [0, 0, 0, 1, 1, 1, 1, 1];
    if (values.number('interpolation_mode', 0) === 1) throw new Error('a Gradient\'s constant interpolation has no CSS form');
    values.number('interpolation_color_space', 0);
    offsets.forEach((offset, index) => stops.push(`${css(colors.slice(index * 4, index * 4 + 4))} ${String(Math.round(offset * 10000) / 100)}%`));
  }
  if (stops.length === 1) stops.push(stops[0] as string);
  const [fx = 0, fy = 0] = from;
  const [tx = 1, ty = 0] = to;
  const image =
    fill === 1
      ? `radial-gradient(circle ${px(Math.hypot((tx - fx) * width, (ty - fy) * height))} at ${String(fx * 100)}% ${String(fy * 100)}%, ${stops.join(', ')})`
      : `linear-gradient(${String(Math.round((Math.atan2((tx - fx) * width, -(ty - fy) * height) * 180) / Math.PI))}deg, ${stops.join(', ')})`;
  return { image, size: [width, height] };
}

/** The text style a Label or Button draws with: its LabelSettings, else its theme overrides, else the theme's. */
function textStyle(stated: Stated, resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>, defaultColor: readonly number[], style: Record<string, GodotControlStyleValue>): void {
  const settingsKey = stated.resource('label_settings');
  const settings = settingsKey === undefined ? undefined : resources.get(settingsKey);
  const font = (key: string | undefined) => {
    if (key === undefined) return;
    const resource = resources.get(key);
    if (resource?.load === undefined) throw new Error(`a Control's ${resource?.className ?? 'unknown'} font has no file the page loads`);
    style['fontFamily'] = { fontFamily: key };
  };
  if (settings !== undefined) {
    const own = new Stated(settings.setters);
    style['fontSize'] = px(own.number('font_size', THEME.fontSize));
    style['color'] = css(own.components('font_color') ?? [1, 1, 1, 1]);
    font(own.resource('font'));
    const outline = own.number('outline_size', 0);
    const shadows: string[] = [];
    if (outline > 0) style['WebkitTextStroke'] = `${px(outline / 2)} ${css(own.components('outline_color') ?? [1, 1, 1, 1])}`;
    const shadow = own.components('shadow_color');
    if (shadow !== undefined && (shadow[3] ?? 1) > 0) {
      const offset = own.components('shadow_offset') ?? [1, 1];
      shadows.push(`${px(offset[0] ?? 1)} ${px(offset[1] ?? 1)} ${px(own.number('shadow_size', 1))} ${css(shadow)}`);
    }
    if (shadows.length > 0) style['textShadow'] = shadows.join(', ');
    own.number('line_spacing', 3);
    own.number('paragraph_spacing', 0);
    const unread = own.unread();
    if (unread.length > 0) throw new Error(`LabelSettings' ${unread.join(', ')} has no CSS form`);
    return;
  }
  // Unstated, the size and font are the ones the element inherits: its Theme's defaults, else the
  // page's (Godot's default theme, `GodotStretch`), as Godot looks a theme item up the branch.
  const size = override(stated, 'font_sizes', 'font_size');
  if (size?.kind === 'number') style['fontSize'] = px(size.value);
  const color = override(stated, 'colors', 'font_color');
  style['color'] = css(color !== undefined && 'components' in color ? color.components : defaultColor);
  const fontOverride = override(stated, 'fonts', 'font');
  font(fontOverride?.kind === 'resource' ? fontOverride.key : undefined);
  const outline = override(stated, 'constants', 'outline_size');
  if (outline?.kind === 'number' && outline.value > 0) {
    const outlineColor = override(stated, 'colors', 'font_outline_color');
    style['WebkitTextStroke'] = `${px(outline.value / 2)} ${css(outlineColor !== undefined && 'components' in outlineColor ? outlineColor.components : [0, 0, 0, 1])}`;
  }
  const shadowColor = override(stated, 'colors', 'font_shadow_color');
  if (shadowColor !== undefined && 'components' in shadowColor && (shadowColor.components[3] ?? 1) > 0) {
    const x = override(stated, 'constants', 'shadow_offset_x');
    const y = override(stated, 'constants', 'shadow_offset_y');
    style['textShadow'] = `${px(x?.kind === 'number' ? x.value : 1)} ${px(y?.kind === 'number' ? y.value : 1)} 0 ${css(shadowColor.components)}`;
  }
}

/** A Label's or Button's alignment of its text in its box (`HorizontalAlignment`, `VerticalAlignment`). */
function alignedText(stated: Stated, style: Record<string, GodotControlStyleValue>, horizontalDefault: number): void {
  const horizontal = stated.number('horizontal_alignment', horizontalDefault);
  const vertical = stated.number('vertical_alignment', 0);
  style['display'] ??= 'flex';
  style['flexDirection'] = 'column';
  style['justifyContent'] = vertical === 1 ? 'center' : vertical === 2 ? 'flex-end' : 'flex-start';
  style['textAlign'] = horizontal === 1 ? 'center' : horizontal === 2 ? 'right' : horizontal === 3 ? 'justify' : 'left';
  // Without autowrap a line runs as long as its text (`TextServer::AUTOWRAP_OFF`).
  const wrap = stated.number('autowrap_mode', 0);
  style['whiteSpace'] = wrap === 0 ? 'pre' : 'pre-wrap';
  if (wrap === 1) style['wordBreak'] = 'break-all';
  style['lineHeight'] = 'normal';
}

/**
 * A button's pressing beyond the page's click: a toggle button's pressed state turned over by a
 * click (`base-button.ts`), its shortcut's actions (`data-shortcut`, which the viewport's shortcut
 * stage presses it for), and `action_mode` pressing on the press rather than the release.
 */
function buttonEvents(stated: Stated, attributes: Record<string, string | number | boolean>, resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>): { readonly events?: GodotControlDomPlan['events'] } {
  const toggle = stated.bool('toggle_mode', false);
  if (stated.bool('button_pressed', false)) attributes['aria-pressed'] = true;
  // Its shortcut's events, each an action (`Shortcut::matches_event`); another event has no DOM form.
  const shortcut = stated.resource('shortcut');
  if (shortcut !== undefined) {
    const events = new Stated(resources.get(shortcut)?.setters ?? []).get('events');
    const actions = (events?.kind === 'Variant-array' ? events.items : []).map((item) => {
      const action = item.kind === 'resource' ? resources.get(item.key) : undefined;
      const name = action === undefined ? undefined : new Stated(action.setters).string('action');
      if (action?.className !== 'InputEventAction' || name === undefined) throw new Error('a shortcut of an event other than an action has no DOM form');
      return name;
    });
    attributes['data-shortcut'] = actions.join(' ');
  }
  stated.bool('shortcut_feedback', true);
  stated.bool('shortcut_in_tooltip', true);
  if (stated.number('action_mode', 1) === 0) attributes['data-action-mode'] = 'press';
  return toggle ? { events: { onClick: { module: 'base-button', exportName: 'godot_base_button_toggle', args: [], event: true } } } : {};
}

/** What the element draws inside itself, by what its class draws (`DomForm['content']`). */
function content(
  form: DomForm,
  stated: Stated,
  resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>,
  style: Record<string, GodotControlStyleValue>,
  attributes: Record<string, string | number | boolean>,
): { readonly text?: string; readonly parts?: readonly GodotControlPartPlan[]; readonly events?: GodotControlDomPlan['events'] } {
  switch (form.content) {
    case 'none':
      return {};
    case 'text': {
      textStyle(stated, resources, THEME.labelColor, style);
      alignedText(stated, style, 0);
      const text = stated.string('text') ?? '';
      stated.bool('uppercase', false);
      return { text };
    }
    case 'button': {
      // A `<button>` takes its text's font from the branch, as a Label does (the page's own buttons
      // do not inherit it).
      style['font'] = 'inherit';
      // The theme's normal stylebox and font colour (`default_theme.cpp:139`), else the scene's.
      const normal = override(stated, 'styles', 'normal');
      if (normal?.kind === 'resource') {
        const box = resources.get(normal.key);
        if (box === undefined) throw new Error('a Button\'s normal stylebox is not planned');
        styleBoxStyle(box, style);
      } else {
        style['background'] = css(THEME.buttonBackground);
        style['borderRadius'] = px(THEME.cornerRadius);
        style['padding'] = px(THEME.buttonMargin);
      }
      style['border'] ??= 'none';
      style['cursor'] = 'pointer';
      textStyle(stated, resources, THEME.controlFontColor, style);
      alignedText(stated, style, 1);
      if (stated.bool('flat', false)) {
        delete style['background'];
      }
      if (stated.bool('disabled', false)) attributes['disabled'] = true;
      // Its icon at its own size before its text, `h_separation` apart, both centred across the
      // button (`Button::_notification`, `ICON_ALIGNMENT_LEFT`).
      const iconKey = stated.resource('icon');
      if (iconKey === undefined) return { text: stated.string('text') ?? '', ...buttonEvents(stated, attributes, resources) };
      const icon = textureImage(resources, iconKey);
      if (icon.size === undefined) throw new Error('a Button\'s icon has no size the plan knows');
      if (stated.number('icon_alignment', 0) !== 0) throw new Error('a Button\'s icon alignment other than left has no CSS form');
      stated.bool('expand_icon', false);
      style['flexDirection'] = 'row';
      style['alignItems'] = 'center';
      style['justifyContent'] = style['textAlign'] === 'left' ? 'flex-start' : style['textAlign'] === 'right' ? 'flex-end' : 'center';
      style['gap'] = px(4);
      return {
        text: stated.string('text') ?? '',
        parts: [{ tag: 'div', part: 'icon', style: { width: px(icon.size[0]), height: px(icon.size[1]), flex: 'none', backgroundImage: icon.image, backgroundSize: '100% 100%' }, attributes: {} }],
        ...buttonEvents(stated, attributes, resources),
      };
    }
    case 'check': {
      // A box to tick, then the text (`CheckBox::_notification`), the box first by `h_separation`.
      textStyle(stated, resources, THEME.controlFontColor, style);
      style['display'] ??= 'flex';
      style['alignItems'] = 'center';
      style['gap'] = px(THEME.checkSeparation);
      style['cursor'] = 'pointer';
      style['whiteSpace'] = 'pre';
      const checked = stated.bool('button_pressed', false);
      stated.bool('toggle_mode', true);
      // A ButtonGroup's buttons are radio buttons of one name (`ButtonGroup`, `base_button.cpp:447`).
      const group = stated.resource('button_group');
      return {
        text: stated.string('text') ?? '',
        parts: [
          {
            tag: 'input',
            part: 'check',
            style: { margin: 0 },
            attributes: { type: group === undefined ? 'checkbox' : 'radio', ...(group === undefined ? {} : { name: group }), defaultChecked: checked, ...(stated.bool('disabled', false) ? { disabled: true } : {}) },
          },
        ],
      };
    }
    case 'range': {
      // `<input type=range>` over the Range's bounds and step.
      attributes['type'] = 'range';
      attributes['min'] = stated.number('min_value', 0);
      attributes['max'] = stated.number('max_value', 100);
      attributes['step'] = stated.number('step', 1);
      attributes['defaultValue'] = stated.number('value', 0);
      style['margin'] = 0;
      stated.bool('scrollable', true);
      // Its track's stylebox colours the page's slider (`accent-color`), which draws its own track.
      const track = override(stated, 'styles', 'slider');
      if (track?.kind === 'resource') {
        const box = resources.get(track.key);
        const color = box === undefined ? undefined : new Stated(box.setters).components('bg_color');
        if (color !== undefined) style['accentColor'] = css(color);
      }
      return {};
    }
    case 'image': {
      // TextureRect: the texture as the box's background, sized by its stretch mode
      // (`TextureRect::_notification`); flipped by a mirroring transform.
      const texture = stated.resource('texture');
      const drawn = texture === undefined ? undefined : textureImage(resources, texture);
      if (drawn !== undefined) style['backgroundImage'] = drawn.image;
      // `EXPAND_KEEP_SIZE`: the texture's size is the least the box takes (`TextureRect::get_minimum_size`).
      if (stated.number('expand_mode', 0) === 0 && drawn?.size !== undefined) {
        style['minWidth'] ??= px(drawn.size[0]);
        style['minHeight'] ??= px(drawn.size[1]);
      }
      const mode = stated.number('stretch_mode', 0);
      style['backgroundRepeat'] = mode === 1 ? 'repeat' : 'no-repeat';
      style['backgroundSize'] = mode === 0 ? '100% 100%' : mode === 4 || mode === 5 ? 'contain' : mode === 6 ? 'cover' : 'auto';
      style['backgroundPosition'] = mode === 3 || mode === 5 || mode === 6 ? 'center' : 'left top';
      const flips = [stated.bool('flip_h', false) ? 'scaleX(-1)' : '', stated.bool('flip_v', false) ? 'scaleY(-1)' : ''].filter((entry) => entry !== '');
      if (flips.length > 0) style['transform'] = flips.join(' ');
      return {};
    }
    case 'texture-button': {
      const texture = stated.resource('texture_normal');
      const normal = texture === undefined ? undefined : textureImage(resources, texture);
      if (normal !== undefined) style['backgroundImage'] = normal.image;
      for (const name of ['texture_hover', 'texture_disabled', 'texture_focused', 'texture_click_mask']) {
        if (stated.resource(name) !== undefined) throw new Error(`TextureButton's ${name} has no CSS form`);
      }
      // A toggle button's pressed texture, which the button swaps in while it is pressed (`base-button.ts`).
      const pressedTexture = stated.resource('texture_pressed');
      if (pressedTexture !== undefined) {
        attributes['data-texture-normal'] = normal?.image ?? 'none';
        attributes['data-texture-pressed'] = textureImage(resources, pressedTexture).image;
      }
      const mode = stated.number('stretch_mode', 2);
      style['backgroundRepeat'] = mode === 1 ? 'repeat' : 'no-repeat';
      style['backgroundSize'] = mode === 0 ? '100% 100%' : mode === 4 || mode === 5 ? 'contain' : mode === 6 ? 'cover' : 'auto';
      style['backgroundPosition'] = mode === 3 || mode === 5 || mode === 6 ? 'center' : 'left top';
      if (!stated.bool('ignore_texture_size', false) && normal?.size !== undefined) {
        style['minWidth'] ??= px(normal.size[0]);
        style['minHeight'] ??= px(normal.size[1]);
      }
      if (pressedTexture !== undefined && !stated.bool('toggle_mode', false)) throw new Error('a TextureButton\'s texture_pressed outside toggle mode has no CSS form');
      style['border'] = 'none';
      style['padding'] = 0;
      style['backgroundColor'] = 'transparent';
      style['cursor'] = 'pointer';
      return { ...buttonEvents(stated, attributes, resources) };
    }
    case 'progress': {
      // TextureProgressBar filling left to right (`FILL_LEFT_TO_RIGHT`): its under texture, its
      // progress texture clipped to the value's share (`range.ts` clips it anew as the value changes),
      // then its over texture.
      const fill = stated.number('fill_mode', 0);
      if (fill !== 0) throw new Error(`TextureProgressBar's fill_mode ${String(fill)} has no CSS form`);
      const min = stated.number('min_value', 0);
      const max = stated.number('max_value', 100);
      const value = stated.number('value', 0);
      stated.number('step', 1);
      const ratio = max === min ? 0 : (value - min) / (max - min);
      // Its bounds and value, which `range.ts` reads and sets, clipping the progress texture to the value's share.
      attributes['data-min'] = String(min);
      attributes['data-max'] = String(max);
      attributes['data-value'] = String(value);
      // Each texture at its own size from the box's top-left, the progress texture at its offset
      // (`TextureProgressBar::_notification`); the under texture is the least the box takes.
      const offset = stated.components('texture_progress_offset') ?? [0, 0];
      const layer = (name: string, clip: boolean): GodotControlPartPlan[] => {
        const texture = stated.resource(name);
        if (texture === undefined) return [];
        const tint = stated.components(`tint_${name.slice('texture_'.length)}`);
        if (tint !== undefined && tint.some((channel) => channel !== 1)) throw new Error(`TextureProgressBar's tint_${name.slice('texture_'.length)} has no CSS form`);
        const drawn = textureImage(resources, texture);
        if (drawn.size === undefined) throw new Error(`TextureProgressBar's ${name} has no size the plan knows`);
        if (name === 'texture_under') {
          style['minWidth'] ??= px(drawn.size[0]);
          style['minHeight'] ??= px(drawn.size[1]);
        }
        return [
          {
            tag: 'div',
            ...(clip ? { part: 'progress' } : {}),
            style: {
              position: 'absolute',
              left: px(clip ? (offset[0] ?? 0) : 0),
              top: px(clip ? (offset[1] ?? 0) : 0),
              width: px(drawn.size[0]),
              height: px(drawn.size[1]),
              backgroundImage: drawn.image,
              backgroundRepeat: 'no-repeat',
              backgroundSize: '100% 100%',
              ...(clip ? { clipPath: `inset(0 ${String(Math.round((1 - ratio) * 100000) / 1000)}% 0 0)` } : {}),
            },
            attributes: {},
          },
        ];
      };
      stated.bool('nine_patch_stretch', false);
      return { parts: [...layer('texture_under', false), ...layer('texture_progress', true), ...layer('texture_over', false)] };
    }
    case 'touch': {
      // TouchScreenButton, a Node2D: its texture at its own size, at its position and scale, pressing
      // its action while a pointer holds it (`TouchScreenButton::_press`), a pointer sliding onto it
      // pressing it too with `passby_press`, its pressed texture drawn while pressed
      // (`touch-screen-button.ts`). A CanvasTexture without an image draws Godot's white texel,
      // tinted by `self_modulate`: the box's colour.
      const texture = stated.resource('texture_normal');
      const normal = texture === undefined ? undefined : textureImage(resources, texture);
      const tint = stated.components('self_modulate') ?? [1, 1, 1, 1];
      if (normal !== undefined) {
        if (normal.size === undefined) throw new Error('TouchScreenButton\'s texture has no size the plan knows');
        style['width'] = px(normal.size[0]);
        style['height'] = px(normal.size[1]);
        if (normal.image === 'linear-gradient(white, white)') style['backgroundColor'] = css(tint);
        else {
          if (tint.some((channel) => channel !== 1)) throw new Error('TouchScreenButton\'s self_modulate tint of an image has no CSS form');
          style['backgroundImage'] = normal.image;
          style['backgroundSize'] = '100% 100%';
        }
      }
      const pressedTexture = stated.resource('texture_pressed');
      if (pressedTexture !== undefined) {
        attributes['data-texture-normal'] = normal?.image ?? 'none';
        attributes['data-texture-pressed'] = textureImage(resources, pressedTexture).image;
      }
      const action = stated.string('action') ?? '';
      const passby = stated.bool('passby_press', false);
      // `VISIBILITY_TOUCHSCREEN_ONLY`: shown only where the page has a touch screen.
      const visibility = stated.number('visibility_mode', 0);
      if (visibility === 1) style['display'] = { touchscreenOnly: true };
      style['touchAction'] = 'none';
      const press = (pressed: boolean) => ({ module: 'touch-screen-button', exportName: 'godot_touch_screen_button_press', args: [action, pressed], event: true as const });
      return {
        events: {
          onPointerDown: press(true),
          onPointerUp: press(false),
          onPointerLeave: press(false),
          ...(passby ? { onPointerEnter: { module: 'touch-screen-button', exportName: 'godot_touch_screen_button_pass', args: [action], event: true as const } } : {}),
        },
      };
    }
    case 'color': {
      // ColorRect: its colour filling its box.
      style['background'] = css(stated.components('color') ?? [1, 1, 1, 1]);
      return {};
    }
    case 'separator': {
      // HSeparator: its `separator` stylebox, a line across the middle of its `separation` height.
      style['display'] ??= 'flex';
      style['flexDirection'] = 'column';
      style['justifyContent'] = 'center';
      const separation = override(stated, 'constants', 'separation');
      style['minHeight'] = px(separation?.kind === 'number' ? separation.value : THEME.separation);
      const line: Record<string, GodotControlStyleValue> = { alignSelf: 'stretch' };
      const separator = override(stated, 'styles', 'separator');
      if (separator?.kind === 'resource') {
        const box = resources.get(separator.key);
        if (box === undefined) throw new Error('a separator\'s stylebox is not planned');
        styleBoxLineStyle(box, line);
      } else line['borderTop'] = `1px solid ${css(THEME.separatorColor)}`;
      return { parts: [{ tag: 'div', style: line, attributes: {} }] };
    }
  }
}

/** A Control's property as the CSS property its element animates, and a key's value as that property's. */
const ANIMATED: Readonly<Record<string, { readonly css: string; readonly value: (value: unknown) => string | number }>> = {
  'theme_override_colors/font_color': { css: 'color', value: (value) => css((value as { readonly Color: readonly number[] }).Color) },
  'theme_override_colors/font_outline_color': { css: 'webkitTextStrokeColor', value: (value) => css((value as { readonly Color: readonly number[] }).Color) },
  rotation: { css: 'rotate', value: (value) => `${String(value as number)}rad` },
  position: {
    css: 'translate',
    value: (value) => {
      const [x = 0, y = 0] = (value as { readonly Vector2: readonly number[] }).Vector2;
      return `${px(x)} ${px(y)}`;
    },
  },
};

/**
 * An AnimationPlayer's libraries among Controls as Web Animations keyframes: value tracks of the
 * properties CSS animates (`ANIMATED`), linear between keys; any other track refuses by name.
 */
function animationsPlan(stated: Stated, resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>): GodotControlAnimationsPlan {
  const root = stated.string('root_node') ?? '..';
  const autoplay = stated.string('autoplay');
  const animations: GodotControlAnimationsPlan['animations'][number][] = [];
  for (const name of stated.names().filter((entry) => entry.startsWith('libraries/'))) {
    const key = stated.resource(name);
    const library = key === undefined ? undefined : resources.get(key)?.animations;
    if (library === undefined) throw new Error(`${name} is not a planned AnimationLibrary`);
    const prefix = name.slice('libraries/'.length);
    for (const { name: animationName, animation } of library.animations) {
      const tracks = animation.tracks.filter((track) => track.enabled).map((track) => {
        const colon = track.path.indexOf(':');
        const property = colon < 0 ? '' : track.path.slice(colon + 1);
        const mapped = ANIMATED[property];
        if (track.type !== 'value' || mapped === undefined) throw new Error(`an animation track of ${track.path} among Controls has no CSS form`);
        if (track.interp !== 1 && track.interp !== 0) throw new Error(`the ${track.path} track's cubic interpolation among Controls has no CSS form`);
        const length = animation.length > 0 ? animation.length : 1;
        const keyframes = track.keys.map(([time, , value]) => ({ offset: Math.min(1, time / length), [mapped.css]: mapped.value(value), ...(track.update === 1 || track.interp === 0 ? { easing: 'steps(1, end)' } : {}) }));
        // The first key's value holds from the start, the last's to the end (`Animation::value_track_interpolate`).
        const first = keyframes[0];
        const last = keyframes.at(-1);
        if (first !== undefined && first.offset > 0) keyframes.unshift({ ...first, offset: 0 });
        if (last !== undefined && last.offset < 1) keyframes.push({ ...last, offset: 1 });
        return { path: track.path.slice(0, colon), keyframes };
      });
      animations.push({ name: prefix === '' ? animationName : `${prefix}/${animationName}`, length: animation.length, loop: animation.loopMode, tracks });
    }
  }
  stated.number('playback_default_blend_time', 0);
  stated.number('speed_scale', 1);
  return { root, ...(autoplay === undefined || autoplay === '' ? {} : { autoplay }), animations };
}

/** A container's own layout of its children, and the stylebox a panel draws behind them. */
function containerStyle(form: DomForm, stated: Stated, resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>, style: Record<string, GodotControlStyleValue>): void {
  switch (form.layout) {
    case 'none':
      return;
    case 'row':
    case 'column': {
      // BoxContainer: its children in a row or column, `separation` apart, packed by its alignment.
      style['display'] = 'flex';
      style['flexDirection'] = form.layout;
      const separation = override(stated, 'constants', 'separation');
      style['gap'] = px(separation?.kind === 'number' ? separation.value : THEME.separation);
      const alignment = stated.number('alignment', 0);
      style['justifyContent'] = alignment === 1 ? 'center' : alignment === 2 ? 'flex-end' : 'flex-start';
      return;
    }
    case 'stack':
    case 'center': {
      style['display'] = 'grid';
      style['gridTemplate'] = '1fr / 1fr';
      // MarginContainer's margins; PanelContainer's panel stylebox, its content margins inside it.
      const margins = SIDES.map((side) => override(stated, 'constants', `margin_${side}`));
      if (margins.some((margin) => margin !== undefined)) {
        const [left, top, right, bottom] = margins.map((margin) => (margin?.kind === 'number' ? margin.value : 0)) as [number, number, number, number];
        style['padding'] = [top, right, bottom, left].map(px).join(' ');
      }
      if (form.panel === true) {
        const panel = override(stated, 'styles', 'panel');
        if (panel?.kind === 'resource') {
          const box = resources.get(panel.key);
          if (box === undefined) throw new Error('a panel\'s stylebox is not planned');
          styleBoxStyle(box, style);
        } else style['background'] = css(THEME.panelBackground);
      }
      stated.bool('use_top_left', false);
      return;
    }
  }
}

/**
 * A Control's Theme: its default font and font size, which CSS's `font-family` and `font-size` hand
 * down the branch as Godot's theme lookup does for the default font (`Theme::get_default_font`).
 * A Theme's per-class items have no inline CSS form and refuse by name.
 */
function themeStyle(stated: Stated, resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>, style: Record<string, GodotControlStyleValue>): void {
  const key = stated.resource('theme');
  if (key === undefined) return;
  const theme = resources.get(key);
  if (theme === undefined) throw new Error('a Control\'s Theme is not planned');
  for (const { name, value } of theme.rawProperties ?? []) {
    if (name === 'default_font' && value.kind === 'resource') {
      const font = resources.get(value.key);
      if (font?.load === undefined) throw new Error('a Theme\'s default font has no file the page loads');
      style['fontFamily'] = { fontFamily: value.key };
    } else if (name === 'default_font_size' && value.kind === 'number') style['fontSize'] = px(value.value);
    else if (name !== 'default_base_scale') throw new Error(`a Theme's ${name} has no inline CSS form`);
  }
}

/** Where the element takes pointer input: `mouse_filter`, its class's default unless stated. */
function pointerStyle(form: DomForm, stated: Stated, style: Record<string, GodotControlStyleValue>): void {
  const filter = stated.number('mouse_filter', form.mouseFilter);
  style['pointerEvents'] = filter === 2 ? 'none' : 'auto';
}

/** A Control's transform: its rotation and scale about its pivot (`Control::get_transform`). */
function transformStyle(stated: Stated, style: Record<string, GodotControlStyleValue>): void {
  const rotation = stated.number('rotation', 0);
  const scale = stated.components('scale') ?? [1, 1];
  const pivot = stated.components('pivot_offset') ?? [0, 0];
  const ratio = stated.components('pivot_offset_ratio');
  // CSS's own `rotate` and `scale`, which a script's rotation and scale set in turn (`control.ts`).
  if (rotation !== 0) style['rotate'] = `${String(rotation)}rad`;
  if (scale[0] !== 1 || scale[1] !== 1) style['scale'] = `${String(scale[0])} ${String(scale[1])}`;
  if (rotation === 0 && scale[0] === 1 && scale[1] === 1 && pivot[0] === 0 && pivot[1] === 0 && ratio === undefined) return;
  style['transformOrigin'] = ratio === undefined ? `${px(pivot[0] ?? 0)} ${px(pivot[1] ?? 0)}` : `calc(${String((ratio[0] ?? 0) * 100)}% + ${px(pivot[0] ?? 0)}) calc(${String((ratio[1] ?? 0) * 100)}% + ${px(pivot[1] ?? 0)})`;
}

/** The Godot-only state the Node protocol reads from the element's `data-*` attributes (`node.ts`). */
function domData(node: DirectGodotSceneNodePlan, classes: boolean): Record<string, string> {
  const data: Record<string, string> = { name: node.name };
  if (classes) data['classes'] = node.classes.join(' ');
  if (node.groups.length > 0) data['groups'] = node.groups.join(' ');
  if (node.unique === true) data['uniqueNameInOwner'] = 'true';
  if (node.siblingIndex !== undefined) data['index'] = String(node.siblingIndex);
  const processMode = node.setters.find((entry) => entry.setter.exportName === 'set_process_mode')?.value;
  if (processMode?.kind === 'number') data['processMode'] = String(processMode.value);
  return data;
}

/**
 * A Control node's element: its tag, style, attributes, text and parts, placed by its parent's
 * layout (`parentLayout`, undefined outside a container).
 */
export function godotControlDom(
  node: DirectGodotSceneNodePlan,
  form: DomForm,
  parentLayout: DomForm['layout'] | undefined,
  resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>,
): GodotControlDomPlan {
  const stated = new Stated(node.setters);
  // An AnimationPlayer among Controls: a hidden element holding its animations (`animation-player.ts`).
  if (form.content === 'animations') {
    const animations = animationsPlan(stated, resources);
    const unread = stated.unread();
    if (unread.length > 0) throw new Error(`${node.classes[0] ?? 'a node'}'s ${unread.join(', ')} among Controls has no idiomatic form`);
    return { tag: form.tag, style: {}, attributes: { hidden: true }, data: domData(node, true), animations };
  }
  for (const name of INERT) stated.get(name);
  // `process_mode` and the metadata the Node protocol keeps (`data-*`, `domData`).
  stated.get('process_mode');
  const style: Record<string, GodotControlStyleValue> = {};
  const attributes: Record<string, string | number | boolean> = {};
  // A touch button's `self_modulate` is its colour (`content`), not a tint of its drawing.
  canvasItemStyle(stated, style, form.content === 'touch');
  if (form.node2d === true) node2dStyle(stated, style);
  else if (parentLayout === undefined || parentLayout === 'none') anchoredStyle(stated, style);
  else placedStyle(stated, parentLayout, style);
  const minimum = stated.components('custom_minimum_size');
  if (minimum !== undefined) {
    if ((minimum[0] ?? 0) > 0) style['minWidth'] = px(minimum[0] as number);
    if ((minimum[1] ?? 0) > 0) style['minHeight'] = px(minimum[1] as number);
  }
  if (form.node2d !== true && (parentLayout === undefined || parentLayout === 'none')) {
    // An anchored box keeps its own size: `size_flags` place it only inside a container.
    stated.get('size_flags_horizontal');
    stated.get('size_flags_vertical');
    stated.get('size_flags_stretch_ratio');
  }
  pointerStyle(form, stated, style);
  themeStyle(stated, resources, style);
  containerStyle(form, stated, resources, style);
  const drawn = content(form, stated, resources, style, attributes);
  if (form.node2d !== true) transformStyle(stated, style);
  if (stated.bool('clip_contents', false)) style['overflow'] = 'hidden';
  if (form.tag === 'button') attributes['type'] = 'button';
  const unread = stated.unread().filter((name) => !name.startsWith('metadata/'));
  if (unread.length > 0) throw new Error(`${node.classes[0] ?? 'a Control'}'s ${unread.join(', ')} has no idiomatic form in its element`);
  const data = domData(node, true);
  // A hidden Control keeps the display its layout gives it for when it is shown (`canvas-item.ts`).
  if (!stated.bool('visible', true)) {
    const display = form.layout === 'row' || form.layout === 'column' || form.content === 'text' || form.content === 'button' || form.content === 'check' || form.content === 'separator' ? 'flex' : form.layout === 'stack' || form.layout === 'center' ? 'grid' : '';
    if (display !== '') data['display'] = display;
    style['display'] = 'none';
  }
  return { tag: form.tag, style, attributes, data, ...drawn };
}

/** The scenes with each Control's element planned (`dom`); a Control with no CSS form refuses its scene by name. */
export function planGodotSceneControls(scenes: readonly SceneWithoutRefs[], refuse: (at: string, message: string) => void): SceneWithoutRefs[] {
  return scenes.map((scene) => {
    const resources = new Map(scene.resources.map((resource) => [resource.key, resource] as const));
    const stamp = (node: DirectGodotSceneNodePlan, parentLayout: DomForm['layout'] | undefined): DirectGodotSceneNodePlan => {
      // A node three mounts has, among Controls, the element its idiom gives it there (`amongControls`).
      const among = parentLayout !== undefined && node.idiom?.form.kind !== 'dom' ? node.idiom?.amongControls : undefined;
      const form = among ?? node.idiom?.form;
      const dom = form?.kind === 'dom' && node.instance === undefined ? form : undefined;
      const layout = dom?.layout;
      let planned: GodotControlDomPlan | undefined;
      if (dom !== undefined) {
        try {
          planned = godotControlDom(node, dom, parentLayout, resources);
        } catch (error) {
          refuse(`${scene.sourceResPath}#${node.nodePath}`, error instanceof Error ? error.message : String(error));
        }
      }
      // An instance of a Control scene takes its root's element as it is: an override of the root's
      // properties is not carried into it.
      if (node.instance !== undefined && node.instanceOf?.rootIdiom?.form.kind === 'dom' && node.instanceOf.changed.length > 0) {
        refuse(`${scene.sourceResPath}#${node.nodePath}`, `the instance's ${node.instanceOf.changed.map((entry) => entry.propertyName).join(', ')} on a Control scene's root is not carried`);
      }
      // A non-Control under a Control has no element to hang from.
      if (form?.kind === 'dom') {
        for (const child of godotSceneSubnodes(node)) {
          const childForm = child.idiom?.amongControls?.kind ?? child.idiom?.form.kind ?? child.instanceOf?.rootIdiom?.form.kind;
          if (childForm !== 'dom') refuse(`${scene.sourceResPath}#${child.nodePath}`, `a ${child.classes[0] ?? 'node'} under a Control has no element to hang from`);
        }
      }
      // The host its Controls hang in when the node renders no element: stacked by its canvas layer
      // (the viewport's own canvas, 0, for any other node) and hidden with it.
      const hosts = dom === undefined && node.children.some((child) => (child.idiom?.form.kind ?? child.instanceOf?.rootIdiom?.form.kind) === 'dom');
      const layer = node.setters.find((entry) => entry.propertyName === 'layer')?.value;
      const hidden = node.idiom?.canvasLayer !== undefined && node.setters.some((entry) => entry.propertyName === 'visible' && entry.value.kind === 'bool' && !entry.value.value);
      const domHost = hosts ? { style: { zIndex: layer?.kind === 'number' ? layer.value : (node.idiom?.canvasLayer ?? 0), ...(hidden ? { display: 'none' } : {}) } } : undefined;
      return {
        ...node,
        // Among Controls, the node is the element its idiom gives it there.
        ...(among === undefined || node.idiom === undefined ? {} : { idiom: { ...node.idiom, form: among, three: 'HTMLDivElement' } }),
        ...(planned === undefined ? {} : { dom: planned }),
        ...(domHost === undefined ? {} : { domHost }),
        children: node.children.map((child) => stamp(child, dom === undefined ? undefined : layout)),
        ...(node.placements === undefined ? {} : { placements: node.placements.map((placed) => ({ at: placed.at, node: stamp(placed.node, undefined) })) }),
      };
    };
    return { ...scene, root: stamp(scene.root, undefined) };
  });
}
