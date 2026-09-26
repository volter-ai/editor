/**
 * Direct TypeScript transcription of Godot 4.7's StyleBox, StyleBoxEmpty and StyleBoxFlat state
 * protocol from scene/resources/style_box.{h,cpp} and style_box_flat.{h,cpp}, pinned at
 * 5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88. The translator only serializes authored state.
 */

import type { ColorValue } from './variant';
import type { Graphics } from 'pixi.js';
import { godotCanvasDrawingTarget } from './canvas-draw';
import type { GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
  hasGodotResourceProtocol,
} from './resource-io';
import type { GodotConnection } from './signal';

export const SIDE_LEFT = 0;
export const SIDE_TOP = 1;
export const SIDE_RIGHT = 2;
export const SIDE_BOTTOM = 3;

export const CORNER_TOP_LEFT = 0;
export const CORNER_TOP_RIGHT = 1;
export const CORNER_BOTTOM_RIGHT = 2;
export const CORNER_BOTTOM_LEFT = 3;

export type GodotSide = 0 | 1 | 2 | 3;
export type GodotCorner = 0 | 1 | 2 | 3;
export type GodotSides = [left: number, top: number, right: number, bottom: number];
export type GodotCorners = [
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
];

export interface GodotPoint2 {
  readonly x: number;
  readonly y: number;
}

export interface GodotRect2 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GodotStyleBoxCss {
  readonly boxSizing?: 'border-box';
  readonly backgroundColor?: string;
  readonly borderImageOutset?: string;
  readonly borderImageRepeat?: string;
  readonly borderImageSlice?: string;
  readonly borderImageSource?: string;
  readonly borderImageWidth?: string;
  readonly borderColor?: string;
  readonly borderStyle?: 'solid';
  readonly borderWidth?: string;
  readonly borderRadius?: string;
  readonly boxShadow?: string;
  readonly padding?: string;
}

const transparentBlack = (): ColorValue => ({ r: 0, g: 0, b: 0, a: 0 });
const sides = (value: number): GodotSides => [value, value, value, value];
const corners = (value: number): GodotCorners => [value, value, value, value];

function assertSide(side: number): asserts side is GodotSide {
  if (!Number.isInteger(side) || side < 0 || side > 3) {
    throw new RangeError(`godot-compat: StyleBox side ${side} is outside 0..3.`);
  }
}

function assertCorner(corner: number): asserts corner is GodotCorner {
  if (!Number.isInteger(corner) || corner < 0 || corner > 3) {
    throw new RangeError(`godot-compat: StyleBox corner ${corner} is outside 0..3.`);
  }
}

function finite(value: number, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`godot-compat: ${member} requires a finite number.`);
  }
  return value;
}

function bool(value: boolean, member: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`godot-compat: ${member} requires a bool.`);
  }
  return value;
}

function colorValue(value: ColorValue, member: string): ColorValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    ![value.r, value.g, value.b, value.a].every(
      (channel) => typeof channel === 'number' && Number.isFinite(channel),
    )
  ) {
    throw new TypeError(`godot-compat: ${member} requires a finite Color.`);
  }
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function pointValue(value: GodotPoint2, member: string): GodotPoint2 {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.x !== 'number' ||
    !Number.isFinite(value.x) ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.y)
  ) {
    throw new TypeError(`godot-compat: ${member} requires a finite Vector2.`);
  }
  return { x: value.x, y: value.y };
}

function rectValue(value: GodotRect2, member: string): GodotRect2 {
  if (
    typeof value !== 'object' ||
    value === null ||
    ![value.x, value.y, value.width, value.height].every(
      (part) => typeof part === 'number' && Number.isFinite(part),
    )
  ) {
    throw new TypeError(`godot-compat: ${member} requires a finite Rect2.`);
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

/** Godot StyleBox base. Negative content margins delegate to the concrete style margin. */
export class GodotStyleBox {
  readonly contentMargin: GodotSides = sides(-1);

  constructor(godotClass = 'StyleBox') {
    registerGodotObjectIdentity(this, godotClass);
    bindGodotResourceProtocol<GodotStyleBox>(this, {
      createDuplicate: (source) => source.duplicate(false),
      populateDuplicate: (source, target, subresources, memo) => {
        if (
          !subresources ||
          !(source instanceof GodotStyleBoxTexture) ||
          !(target instanceof GodotStyleBoxTexture)
        ) return;
        target.setTexture(duplicateGodotSubresource(source.texture, memo));
      },
    });
  }

  protected changed(): void {
    godotResourceEmitChanged(this);
  }

  setContentMargin(side: number, value: number): void {
    assertSide(side);
    this.contentMargin[side] = finite(value, 'StyleBox.set_content_margin');
    this.changed();
  }

  setContentMarginAll(value: number): void {
    this.contentMargin.fill(finite(value, 'StyleBox.set_content_margin_all'));
    this.changed();
  }

  setContentMarginIndividual(left: number, top: number, right: number, bottom: number): void {
    this.contentMargin[SIDE_LEFT] = finite(left, 'StyleBox.set_content_margin_individual');
    this.contentMargin[SIDE_TOP] = finite(top, 'StyleBox.set_content_margin_individual');
    this.contentMargin[SIDE_RIGHT] = finite(right, 'StyleBox.set_content_margin_individual');
    this.contentMargin[SIDE_BOTTOM] = finite(bottom, 'StyleBox.set_content_margin_individual');
    this.changed();
  }

  getContentMargin(side: number): number {
    assertSide(side);
    return this.contentMargin[side];
  }

  protected getStyleMargin(_side: GodotSide): number {
    return 0;
  }

  getMargin(side: number): number {
    assertSide(side);
    const content = this.contentMargin[side];
    return content < 0 ? this.getStyleMargin(side) : content;
  }

  getMinimumSize(): GodotPoint2 {
    return {
      x: this.getMargin(SIDE_LEFT) + this.getMargin(SIDE_RIGHT),
      y: this.getMargin(SIDE_TOP) + this.getMargin(SIDE_BOTTOM),
    };
  }

  getOffset(): GodotPoint2 {
    return { x: this.getMargin(SIDE_LEFT), y: this.getMargin(SIDE_TOP) };
  }

  getDrawRect(rect: GodotRect2): GodotRect2 {
    return rect;
  }

  testMask(_point: GodotPoint2, _rect: GodotRect2): boolean {
    return true;
  }

  duplicate(deep = false): GodotStyleBox {
    void deep;
    return createStyleBox({ contentMargin: [...this.contentMargin] as GodotSides });
  }

  drawCss(): GodotStyleBoxCss {
    return {};
  }

  set_content_margin(side: number, value: number): void { this.setContentMargin(side, value); }
  set_content_margin_all(value: number): void { this.setContentMarginAll(value); }
  set_content_margin_individual(left: number, top: number, right: number, bottom: number): void {
    this.setContentMarginIndividual(left, top, right, bottom);
  }
  get_content_margin(side: number): number { return this.getContentMargin(side); }
  get_margin(side: number): number { return this.getMargin(side); }
  get_minimum_size(): GodotPoint2 { return this.getMinimumSize(); }
  get_offset(): GodotPoint2 { return this.getOffset(); }
  get_draw_rect(rect: GodotRect2): GodotRect2 { return this.getDrawRect(rectValue(rect, 'StyleBox.get_draw_rect')); }
  test_mask(point: GodotPoint2, rect: GodotRect2): boolean {
    return this.testMask(pointValue(point, 'StyleBox.test_mask'), rectValue(rect, 'StyleBox.test_mask'));
  }
  draw(canvasItem: GodotRid, rect: GodotRect2): void {
    drawStyleBoxPixiOnCanvasItem(this, canvasItem, rectValue(rect, 'StyleBox.draw'));
  }

  get content_margin_left(): number { return this.getContentMargin(SIDE_LEFT); }
  set content_margin_left(value: number) { this.setContentMargin(SIDE_LEFT, value); }
  get content_margin_top(): number { return this.getContentMargin(SIDE_TOP); }
  set content_margin_top(value: number) { this.setContentMargin(SIDE_TOP, value); }
  get content_margin_right(): number { return this.getContentMargin(SIDE_RIGHT); }
  set content_margin_right(value: number) { this.setContentMargin(SIDE_RIGHT, value); }
  get content_margin_bottom(): number { return this.getContentMargin(SIDE_BOTTOM); }
  set content_margin_bottom(value: number) { this.setContentMargin(SIDE_BOTTOM, value); }
}

/** StyleBoxEmpty has zero style margins and an intentionally empty draw method. */
export class GodotStyleBoxEmpty extends GodotStyleBox {
  constructor() {
    super('StyleBoxEmpty');
  }

  duplicate(deep = false): GodotStyleBoxEmpty {
    void deep;
    return createStyleBoxEmpty({ contentMargin: [...this.contentMargin] as GodotSides });
  }

  override drawCss(): GodotStyleBoxCss {
    return {};
  }
}

/**
 * Godot StyleBoxLine state. Drawing is a single integer Rect2i whose long axis grows at both
 * ends; it is not a CSS border and therefore stays owned by the retained drawing entity.
 */
export class GodotStyleBoxLine extends GodotStyleBox {
  color: ColorValue = { r: 0, g: 0, b: 0, a: 1 };
  thickness = 1;
  vertical = false;
  growBegin = 1;
  growEnd = 1;

  constructor() {
    super('StyleBoxLine');
  }

  setColor(color: ColorValue): void {
    this.color = color;
    this.changed();
  }

  getColor(): ColorValue {
    return this.color;
  }

  setThickness(thickness: number): void {
    this.thickness = Math.trunc(thickness);
    this.changed();
  }

  getThickness(): number {
    return this.thickness;
  }

  setVertical(vertical: boolean): void {
    this.vertical = vertical;
    this.changed();
  }

  isVertical(): boolean {
    return this.vertical;
  }

  setGrowBegin(grow: number): void {
    this.growBegin = grow;
    this.changed();
  }

  getGrowBegin(): number {
    return this.growBegin;
  }

  setGrowEnd(grow: number): void {
    this.growEnd = grow;
    this.changed();
  }

  getGrowEnd(): number {
    return this.growEnd;
  }

  duplicate(deep = false): GodotStyleBoxLine {
    void deep;
    return createStyleBoxLine({
      contentMargin: [...this.contentMargin] as GodotSides,
      color: { ...this.color },
      thickness: this.thickness,
      vertical: this.vertical,
      growBegin: this.growBegin,
      growEnd: this.growEnd,
    });
  }

  protected override getStyleMargin(side: GodotSide): number {
    if (this.vertical) {
      return side === SIDE_LEFT || side === SIDE_RIGHT ? this.thickness / 2 : 0;
    }
    return side === SIDE_TOP || side === SIDE_BOTTOM ? this.thickness / 2 : 0;
  }

  override drawCss(): GodotStyleBoxCss {
    throw new Error(
      'godot-compat: StyleBoxLine draws a grown Rect2i; a CSS border is not the same geometry.',
    );
  }

  set_color(value: ColorValue): void { this.setColor(value); }
  get_color(): ColorValue { return this.getColor(); }
  set_thickness(value: number): void { this.setThickness(value); }
  get_thickness(): number { return this.getThickness(); }
  set_vertical(value: boolean): void { this.setVertical(value); }
  is_vertical(): boolean { return this.isVertical(); }
  set_grow_begin(value: number): void { this.setGrowBegin(value); }
  get_grow_begin(): number { return this.getGrowBegin(); }
  set_grow_end(value: number): void { this.setGrowEnd(value); }
  get_grow_end(): number { return this.getGrowEnd(); }

  get grow_begin(): number { return this.growBegin; }
  set grow_begin(value: number) { this.setGrowBegin(value); }
  get grow_end(): number { return this.growEnd; }
  set grow_end(value: number) { this.setGrowEnd(value); }
}

export const AXIS_STRETCH_MODE_STRETCH = 0;
export const AXIS_STRETCH_MODE_TILE = 1;
export const AXIS_STRETCH_MODE_TILE_FIT = 2;
export type GodotAxisStretchMode = 0 | 1 | 2;

function assertAxisStretchMode(mode: number): asserts mode is GodotAxisStretchMode {
  if (!Number.isInteger(mode) || mode < 0 || mode > 2) {
    throw new RangeError(`godot-compat: StyleBoxTexture axis stretch mode ${mode} is outside 0..2.`);
  }
}

/**
 * Godot StyleBoxTexture state. `texture` is the project-owned native texture identity (a copied
 * asset URL on DOM and Pixi's Texture on canvas), never decoded inside this resource class.
 */
export class GodotStyleBoxTexture<TextureValue = unknown> extends GodotStyleBox {
  texture: TextureValue | null = null;
  readonly textureMargin: GodotSides = sides(0);
  readonly expandMargin: GodotSides = sides(0);
  regionRect: GodotRect2 = { x: 0, y: 0, width: 0, height: 0 };
  drawCenter = true;
  modulate: ColorValue = { r: 1, g: 1, b: 1, a: 1 };
  horizontalAxisStretchMode: GodotAxisStretchMode = AXIS_STRETCH_MODE_STRETCH;
  verticalAxisStretchMode: GodotAxisStretchMode = AXIS_STRETCH_MODE_STRETCH;
  private textureChanged: GodotConnection | null = null;

  constructor() {
    super('StyleBoxTexture');
  }

  setTexture(texture: TextureValue | null): void {
    if (texture !== null && typeof texture !== 'string' &&
        ((typeof texture !== 'object' || texture === null) && typeof texture !== 'function')) {
      throw new TypeError('godot-compat: StyleBoxTexture.texture requires a Texture Resource or URL.');
    }
    if (this.texture === texture) return;
    this.textureChanged?.disconnect();
    this.textureChanged = null;
    this.texture = texture;
    if (hasGodotResourceProtocol(texture)) {
      this.textureChanged = godotResourceChangedSignal(texture).connect(() => this.changed());
    }
    this.changed();
  }

  getTexture(): TextureValue | null {
    return this.texture;
  }

  setTextureMargin(side: number, size: number): void {
    assertSide(side);
    this.textureMargin[side] = finite(size, 'StyleBoxTexture.set_texture_margin');
    this.changed();
  }

  setTextureMarginAll(size: number): void {
    this.textureMargin.fill(finite(size, 'StyleBoxTexture.set_texture_margin_all'));
    this.changed();
  }

  setTextureMarginIndividual(left: number, top: number, right: number, bottom: number): void {
    this.textureMargin[SIDE_LEFT] = finite(left, 'StyleBoxTexture.set_texture_margin_individual');
    this.textureMargin[SIDE_TOP] = finite(top, 'StyleBoxTexture.set_texture_margin_individual');
    this.textureMargin[SIDE_RIGHT] = finite(right, 'StyleBoxTexture.set_texture_margin_individual');
    this.textureMargin[SIDE_BOTTOM] = finite(bottom, 'StyleBoxTexture.set_texture_margin_individual');
    this.changed();
  }

  getTextureMargin(side: number): number {
    assertSide(side);
    return this.textureMargin[side];
  }

  setExpandMargin(side: number, size: number): void {
    assertSide(side);
    this.expandMargin[side] = finite(size, 'StyleBoxTexture.set_expand_margin');
    this.changed();
  }

  setExpandMarginAll(size: number): void {
    this.expandMargin.fill(finite(size, 'StyleBoxTexture.set_expand_margin_all'));
    this.changed();
  }

  setExpandMarginIndividual(left: number, top: number, right: number, bottom: number): void {
    this.expandMargin[SIDE_LEFT] = finite(left, 'StyleBoxTexture.set_expand_margin_individual');
    this.expandMargin[SIDE_TOP] = finite(top, 'StyleBoxTexture.set_expand_margin_individual');
    this.expandMargin[SIDE_RIGHT] = finite(right, 'StyleBoxTexture.set_expand_margin_individual');
    this.expandMargin[SIDE_BOTTOM] = finite(bottom, 'StyleBoxTexture.set_expand_margin_individual');
    this.changed();
  }

  getExpandMargin(side: number): number {
    assertSide(side);
    return this.expandMargin[side];
  }

  setRegionRect(region: GodotRect2): void {
    this.regionRect = rectValue(region, 'StyleBoxTexture.set_region_rect');
    this.changed();
  }

  getRegionRect(): GodotRect2 {
    return { ...this.regionRect };
  }

  setDrawCenter(enabled: boolean): void {
    this.drawCenter = bool(enabled, 'StyleBoxTexture.set_draw_center');
    this.changed();
  }

  isDrawCenterEnabled(): boolean {
    return this.drawCenter;
  }

  setModulate(color: ColorValue): void {
    this.modulate = colorValue(color, 'StyleBoxTexture.set_modulate');
    this.changed();
  }

  getModulate(): ColorValue {
    return { ...this.modulate };
  }

  setHorizontalAxisStretchMode(mode: number): void {
    assertAxisStretchMode(mode);
    this.horizontalAxisStretchMode = mode;
    this.changed();
  }

  getHorizontalAxisStretchMode(): GodotAxisStretchMode {
    return this.horizontalAxisStretchMode;
  }

  setVerticalAxisStretchMode(mode: number): void {
    assertAxisStretchMode(mode);
    this.verticalAxisStretchMode = mode;
    this.changed();
  }

  getVerticalAxisStretchMode(): GodotAxisStretchMode {
    return this.verticalAxisStretchMode;
  }

  duplicate(deep = false): GodotStyleBoxTexture<TextureValue> {
    if (deep) {
      throw new Error(
        'godot-compat: StyleBoxTexture.duplicate(true) cannot preserve nested Texture Resource duplication.',
      );
    }
    return createStyleBoxTexture({
      contentMargin: [...this.contentMargin] as GodotSides,
      texture: this.texture,
      textureMargin: [...this.textureMargin] as GodotSides,
      expandMargin: [...this.expandMargin] as GodotSides,
      regionRect: { ...this.regionRect },
      drawCenter: this.drawCenter,
      modulate: { ...this.modulate },
      horizontalAxisStretchMode: this.horizontalAxisStretchMode,
      verticalAxisStretchMode: this.verticalAxisStretchMode,
    });
  }

  protected override getStyleMargin(side: GodotSide): number {
    return this.textureMargin[side];
  }

  override getDrawRect(rect: GodotRect2): GodotRect2 {
    return {
      x: rect.x - this.expandMargin[SIDE_LEFT],
      y: rect.y - this.expandMargin[SIDE_TOP],
      width: rect.width + this.expandMargin[SIDE_LEFT] + this.expandMargin[SIDE_RIGHT],
      height: rect.height + this.expandMargin[SIDE_TOP] + this.expandMargin[SIDE_BOTTOM],
    };
  }

  override drawCss(): GodotStyleBoxCss {
    if (this.texture === null) return {};
    if (typeof this.texture !== 'string') {
      throw new TypeError(
        'godot-compat: DOM StyleBoxTexture requires its project-owned texture URL string.',
      );
    }
    if (
      this.regionRect.x !== 0 ||
      this.regionRect.y !== 0 ||
      this.regionRect.width !== 0 ||
      this.regionRect.height !== 0
    ) {
      throw new Error(
        'godot-compat: DOM StyleBoxTexture.region_rect requires a cropped native image source.',
      );
    }
    if (
      this.modulate.r !== 1 ||
      this.modulate.g !== 1 ||
      this.modulate.b !== 1 ||
      this.modulate.a !== 1
    ) {
      throw new Error(
        'godot-compat: DOM border-image cannot preserve StyleBoxTexture.modulate_color.',
      );
    }
    const axisRepeat = (mode: GodotAxisStretchMode): 'stretch' | 'repeat' | 'round' =>
      mode === AXIS_STRETCH_MODE_STRETCH
        ? 'stretch'
        : mode === AXIS_STRETCH_MODE_TILE
          ? 'repeat'
          : 'round';
    const [left, top, right, bottom] = this.textureMargin;
    const [expandLeft, expandTop, expandRight, expandBottom] = this.expandMargin;
    return {
      boxSizing: 'border-box',
      borderStyle: 'solid',
      borderWidth: `${top}px ${right}px ${bottom}px ${left}px`,
      borderImageSource: `url(${JSON.stringify(this.texture)})`,
      borderImageSlice: `${top} ${right} ${bottom} ${left}${this.drawCenter ? ' fill' : ''}`,
      borderImageWidth: `${top}px ${right}px ${bottom}px ${left}px`,
      borderImageOutset: `${expandTop}px ${expandRight}px ${expandBottom}px ${expandLeft}px`,
      borderImageRepeat:
        `${axisRepeat(this.horizontalAxisStretchMode)} ${axisRepeat(this.verticalAxisStretchMode)}`,
    };
  }

  set_texture(value: TextureValue | null): void { this.setTexture(value); }
  get_texture(): TextureValue | null { return this.getTexture(); }
  set_texture_margin(side: number, value: number): void { this.setTextureMargin(side, value); }
  set_texture_margin_all(value: number): void { this.setTextureMarginAll(value); }
  set_texture_margin_individual(left: number, top: number, right: number, bottom: number): void {
    this.setTextureMarginIndividual(left, top, right, bottom);
  }
  get_texture_margin(side: number): number { return this.getTextureMargin(side); }
  set_expand_margin(side: number, value: number): void { this.setExpandMargin(side, value); }
  set_expand_margin_all(value: number): void { this.setExpandMarginAll(value); }
  set_expand_margin_individual(left: number, top: number, right: number, bottom: number): void {
    this.setExpandMarginIndividual(left, top, right, bottom);
  }
  get_expand_margin(side: number): number { return this.getExpandMargin(side); }
  set_region_rect(value: GodotRect2): void { this.setRegionRect(value); }
  get_region_rect(): GodotRect2 { return this.getRegionRect(); }
  set_draw_center(value: boolean): void { this.setDrawCenter(value); }
  is_draw_center_enabled(): boolean { return this.isDrawCenterEnabled(); }
  set_modulate(value: ColorValue): void { this.setModulate(value); }
  get_modulate(): ColorValue { return this.getModulate(); }
  set_h_axis_stretch_mode(value: number): void { this.setHorizontalAxisStretchMode(value); }
  get_h_axis_stretch_mode(): GodotAxisStretchMode { return this.getHorizontalAxisStretchMode(); }
  set_v_axis_stretch_mode(value: number): void { this.setVerticalAxisStretchMode(value); }
  get_v_axis_stretch_mode(): GodotAxisStretchMode { return this.getVerticalAxisStretchMode(); }

  get texture_margin_left(): number { return this.getTextureMargin(SIDE_LEFT); }
  set texture_margin_left(value: number) { this.setTextureMargin(SIDE_LEFT, value); }
  get texture_margin_top(): number { return this.getTextureMargin(SIDE_TOP); }
  set texture_margin_top(value: number) { this.setTextureMargin(SIDE_TOP, value); }
  get texture_margin_right(): number { return this.getTextureMargin(SIDE_RIGHT); }
  set texture_margin_right(value: number) { this.setTextureMargin(SIDE_RIGHT, value); }
  get texture_margin_bottom(): number { return this.getTextureMargin(SIDE_BOTTOM); }
  set texture_margin_bottom(value: number) { this.setTextureMargin(SIDE_BOTTOM, value); }
  get expand_margin_left(): number { return this.getExpandMargin(SIDE_LEFT); }
  set expand_margin_left(value: number) { this.setExpandMargin(SIDE_LEFT, value); }
  get expand_margin_top(): number { return this.getExpandMargin(SIDE_TOP); }
  set expand_margin_top(value: number) { this.setExpandMargin(SIDE_TOP, value); }
  get expand_margin_right(): number { return this.getExpandMargin(SIDE_RIGHT); }
  set expand_margin_right(value: number) { this.setExpandMargin(SIDE_RIGHT, value); }
  get expand_margin_bottom(): number { return this.getExpandMargin(SIDE_BOTTOM); }
  set expand_margin_bottom(value: number) { this.setExpandMargin(SIDE_BOTTOM, value); }
  get region_rect(): GodotRect2 { return this.getRegionRect(); }
  set region_rect(value: GodotRect2) { this.setRegionRect(value); }
  get draw_center(): boolean { return this.drawCenter; }
  set draw_center(value: boolean) { this.setDrawCenter(value); }
  get modulate_color(): ColorValue { return this.getModulate(); }
  set modulate_color(value: ColorValue) { this.setModulate(value); }
  get axis_stretch_horizontal(): GodotAxisStretchMode { return this.horizontalAxisStretchMode; }
  set axis_stretch_horizontal(value: number) { this.setHorizontalAxisStretchMode(value); }
  get axis_stretch_vertical(): GodotAxisStretchMode { return this.verticalAxisStretchMode; }
  set axis_stretch_vertical(value: number) { this.setVerticalAxisStretchMode(value); }
}

/** Godot's complete authored state for StyleBoxFlat. */
export class GodotStyleBoxFlat extends GodotStyleBox {
  backgroundColor: ColorValue = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
  shadowColor: ColorValue = { r: 0, g: 0, b: 0, a: 0.6 };
  borderColor: ColorValue = { r: 0.8, g: 0.8, b: 0.8, a: 1 };
  readonly borderWidth: GodotSides = sides(0);
  readonly expandMargin: GodotSides = sides(0);
  readonly cornerRadius: GodotCorners = corners(0);
  drawCenter = true;
  borderBlend = false;
  skew: GodotPoint2 = { x: 0, y: 0 };
  antiAliased = true;
  cornerDetail = 8;
  shadowSize = 0;
  shadowOffset: GodotPoint2 = { x: 0, y: 0 };
  antiAliasingSize = 1;

  constructor() {
    super('StyleBoxFlat');
  }

  setBackgroundColor(color: ColorValue): void {
    this.backgroundColor = colorValue(color, 'StyleBoxFlat.set_bg_color');
    this.changed();
  }

  getBackgroundColor(): ColorValue {
    return { ...this.backgroundColor };
  }

  setBorderColor(color: ColorValue): void {
    this.borderColor = colorValue(color, 'StyleBoxFlat.set_border_color');
    this.changed();
  }

  getBorderColor(): ColorValue {
    return { ...this.borderColor };
  }

  setBorderWidthAll(width: number): void {
    this.borderWidth.fill(Math.trunc(finite(width, 'StyleBoxFlat.set_border_width_all')));
    this.changed();
  }

  getBorderWidthMin(): number {
    return Math.min(...this.borderWidth);
  }

  setBorderWidth(side: number, width: number): void {
    assertSide(side);
    this.borderWidth[side] = Math.trunc(finite(width, 'StyleBoxFlat.set_border_width'));
    this.changed();
  }

  getBorderWidth(side: number): number {
    assertSide(side);
    return this.borderWidth[side];
  }

  setBorderBlend(blend: boolean): void {
    this.borderBlend = blend;
    this.changed();
  }

  getBorderBlend(): boolean {
    return this.borderBlend;
  }

  setCornerRadius(corner: number, radius: number): void {
    assertCorner(corner);
    this.cornerRadius[corner] = Math.trunc(radius);
    this.changed();
  }

  setCornerRadiusAll(radius: number): void {
    this.cornerRadius.fill(Math.trunc(radius));
    this.changed();
  }

  setCornerRadiusIndividual(
    topLeft: number,
    topRight: number,
    bottomRight: number,
    bottomLeft: number,
  ): void {
    this.cornerRadius[CORNER_TOP_LEFT] = Math.trunc(topLeft);
    this.cornerRadius[CORNER_TOP_RIGHT] = Math.trunc(topRight);
    this.cornerRadius[CORNER_BOTTOM_RIGHT] = Math.trunc(bottomRight);
    this.cornerRadius[CORNER_BOTTOM_LEFT] = Math.trunc(bottomLeft);
    this.changed();
  }

  getCornerRadius(corner: number): number {
    assertCorner(corner);
    return this.cornerRadius[corner];
  }

  setCornerDetail(detail: number): void {
    this.cornerDetail = Math.min(20, Math.max(1, Math.trunc(detail)));
    this.changed();
  }

  getCornerDetail(): number {
    return this.cornerDetail;
  }

  setExpandMargin(side: number, size: number): void {
    assertSide(side);
    this.expandMargin[side] = finite(size, 'StyleBoxFlat.set_expand_margin');
    this.changed();
  }

  setExpandMarginAll(size: number): void {
    this.expandMargin.fill(finite(size, 'StyleBoxFlat.set_expand_margin_all'));
    this.changed();
  }

  setExpandMarginIndividual(left: number, top: number, right: number, bottom: number): void {
    this.expandMargin[SIDE_LEFT] = finite(left, 'StyleBoxFlat.set_expand_margin_individual');
    this.expandMargin[SIDE_TOP] = finite(top, 'StyleBoxFlat.set_expand_margin_individual');
    this.expandMargin[SIDE_RIGHT] = finite(right, 'StyleBoxFlat.set_expand_margin_individual');
    this.expandMargin[SIDE_BOTTOM] = finite(bottom, 'StyleBoxFlat.set_expand_margin_individual');
    this.changed();
  }

  getExpandMargin(side: number): number {
    assertSide(side);
    return this.expandMargin[side];
  }

  setDrawCenter(enabled: boolean): void {
    this.drawCenter = bool(enabled, 'StyleBoxFlat.set_draw_center');
    this.changed();
  }

  isDrawCenterEnabled(): boolean {
    return this.drawCenter;
  }

  setSkew(skew: GodotPoint2): void {
    this.skew = skew;
    this.changed();
  }

  getSkew(): GodotPoint2 {
    return this.skew;
  }

  setShadowColor(color: ColorValue): void {
    this.shadowColor = colorValue(color, 'StyleBoxFlat.set_shadow_color');
    this.changed();
  }

  getShadowColor(): ColorValue {
    return { ...this.shadowColor };
  }

  setShadowSize(size: number): void {
    this.shadowSize = Math.trunc(finite(size, 'StyleBoxFlat.set_shadow_size'));
    this.changed();
  }

  getShadowSize(): number {
    return this.shadowSize;
  }

  setShadowOffset(offset: GodotPoint2): void {
    this.shadowOffset = pointValue(offset, 'StyleBoxFlat.set_shadow_offset');
    this.changed();
  }

  getShadowOffset(): GodotPoint2 {
    return { ...this.shadowOffset };
  }

  setAntiAliased(antiAliased: boolean): void {
    this.antiAliased = antiAliased;
    this.changed();
  }

  isAntiAliased(): boolean {
    return this.antiAliased;
  }

  setAntiAliasingSize(size: number): void {
    this.antiAliasingSize = size;
    this.changed();
  }

  getAntiAliasingSize(): number {
    return this.antiAliasingSize;
  }

  duplicate(deep = false): GodotStyleBoxFlat {
    void deep;
    const copy = createStyleBoxFlat({
      contentMargin: [...this.contentMargin] as GodotSides,
      backgroundColor: { ...this.backgroundColor },
      borderColor: { ...this.borderColor },
      borderWidth: [...this.borderWidth] as GodotSides,
      cornerRadius: [...this.cornerRadius] as GodotCorners,
      cornerDetail: this.cornerDetail,
      expandMargin: [...this.expandMargin] as GodotSides,
      drawCenter: this.drawCenter,
      antiAliased: this.antiAliased,
      antiAliasingSize: this.antiAliasingSize,
      shadowColor: { ...this.shadowColor },
      shadowSize: this.shadowSize,
      shadowOffset: { ...this.shadowOffset },
    });
    copy.setBorderBlend(this.borderBlend);
    copy.setSkew({ ...this.skew });
    return copy;
  }

  protected override getStyleMargin(side: GodotSide): number {
    return this.borderWidth[side];
  }

  override getDrawRect(rect: GodotRect2): GodotRect2 {
    return {
      x: rect.x - this.expandMargin[SIDE_LEFT],
      y: rect.y - this.expandMargin[SIDE_TOP],
      width:
        rect.width + this.expandMargin[SIDE_LEFT] + this.expandMargin[SIDE_RIGHT],
      height:
        rect.height + this.expandMargin[SIDE_TOP] + this.expandMargin[SIDE_BOTTOM],
    };
  }

  override drawCss(): GodotStyleBoxCss {
    if (this.shadowSize > 0) {
      throw new Error(
        'godot-compat: positive StyleBoxFlat shadows require Godot vertex-color fade geometry.',
      );
    }
    const [left, top, right, bottom] = this.borderWidth;
    const [topLeft, topRight, bottomRight, bottomLeft] = this.cornerRadius;
    return {
      boxSizing: 'border-box',
      ...(this.drawCenter ? { backgroundColor: colorCss(this.backgroundColor) } : {}),
      borderColor: colorCss(this.borderColor),
      borderStyle: 'solid',
      borderWidth: `${top}px ${right}px ${bottom}px ${left}px`,
      borderRadius: `${topLeft}px ${topRight}px ${bottomRight}px ${bottomLeft}px`,
      ...(this.shadowSize > 0
        ? {
            boxShadow: `${this.shadowOffset.x}px ${this.shadowOffset.y}px 0 ${this.shadowSize}px ${colorCss(this.shadowColor)}`,
          }
        : {}),
    };
  }

  set_bg_color(value: ColorValue): void { this.setBackgroundColor(value); }
  get_bg_color(): ColorValue { return this.getBackgroundColor(); }
  set_border_color(value: ColorValue): void { this.setBorderColor(value); }
  get_border_color(): ColorValue { return this.getBorderColor(); }
  set_border_width_all(value: number): void { this.setBorderWidthAll(value); }
  get_border_width_min(): number { return this.getBorderWidthMin(); }
  set_border_width(side: number, value: number): void { this.setBorderWidth(side, value); }
  get_border_width(side: number): number { return this.getBorderWidth(side); }
  set_border_blend(value: boolean): void { this.setBorderBlend(value); }
  get_border_blend(): boolean { return this.getBorderBlend(); }
  set_corner_radius(corner: number, value: number): void { this.setCornerRadius(corner, value); }
  set_corner_radius_all(value: number): void { this.setCornerRadiusAll(value); }
  set_corner_radius_individual(topLeft: number, topRight: number, bottomRight: number, bottomLeft: number): void {
    this.setCornerRadiusIndividual(topLeft, topRight, bottomRight, bottomLeft);
  }
  get_corner_radius(corner: number): number { return this.getCornerRadius(corner); }
  set_corner_detail(value: number): void { this.setCornerDetail(value); }
  get_corner_detail(): number { return this.getCornerDetail(); }
  set_expand_margin(side: number, value: number): void { this.setExpandMargin(side, value); }
  set_expand_margin_all(value: number): void { this.setExpandMarginAll(value); }
  set_expand_margin_individual(left: number, top: number, right: number, bottom: number): void {
    this.setExpandMarginIndividual(left, top, right, bottom);
  }
  get_expand_margin(side: number): number { return this.getExpandMargin(side); }
  set_draw_center(value: boolean): void { this.setDrawCenter(value); }
  is_draw_center_enabled(): boolean { return this.isDrawCenterEnabled(); }
  set_skew(value: GodotPoint2): void { this.setSkew(value); }
  get_skew(): GodotPoint2 { return this.getSkew(); }
  set_shadow_color(value: ColorValue): void { this.setShadowColor(value); }
  get_shadow_color(): ColorValue { return this.getShadowColor(); }
  set_shadow_size(value: number): void { this.setShadowSize(value); }
  get_shadow_size(): number { return this.getShadowSize(); }
  set_shadow_offset(value: GodotPoint2): void { this.setShadowOffset(value); }
  get_shadow_offset(): GodotPoint2 { return this.getShadowOffset(); }
  set_anti_aliased(value: boolean): void { this.setAntiAliased(value); }
  is_anti_aliased(): boolean { return this.isAntiAliased(); }
  set_aa_size(value: number): void { this.setAntiAliasingSize(value); }
  get_aa_size(): number { return this.getAntiAliasingSize(); }

  get bg_color(): ColorValue { return this.getBackgroundColor(); }
  set bg_color(value: ColorValue) { this.setBackgroundColor(value); }
  get border_color(): ColorValue { return this.getBorderColor(); }
  set border_color(value: ColorValue) { this.setBorderColor(value); }
  get border_width_left(): number { return this.getBorderWidth(SIDE_LEFT); }
  set border_width_left(value: number) { this.setBorderWidth(SIDE_LEFT, value); }
  get border_width_top(): number { return this.getBorderWidth(SIDE_TOP); }
  set border_width_top(value: number) { this.setBorderWidth(SIDE_TOP, value); }
  get border_width_right(): number { return this.getBorderWidth(SIDE_RIGHT); }
  set border_width_right(value: number) { this.setBorderWidth(SIDE_RIGHT, value); }
  get border_width_bottom(): number { return this.getBorderWidth(SIDE_BOTTOM); }
  set border_width_bottom(value: number) { this.setBorderWidth(SIDE_BOTTOM, value); }
  get border_blend(): boolean { return this.borderBlend; }
  set border_blend(value: boolean) { this.setBorderBlend(value); }
  get corner_radius_top_left(): number { return this.getCornerRadius(CORNER_TOP_LEFT); }
  set corner_radius_top_left(value: number) { this.setCornerRadius(CORNER_TOP_LEFT, value); }
  get corner_radius_top_right(): number { return this.getCornerRadius(CORNER_TOP_RIGHT); }
  set corner_radius_top_right(value: number) { this.setCornerRadius(CORNER_TOP_RIGHT, value); }
  get corner_radius_bottom_right(): number { return this.getCornerRadius(CORNER_BOTTOM_RIGHT); }
  set corner_radius_bottom_right(value: number) { this.setCornerRadius(CORNER_BOTTOM_RIGHT, value); }
  get corner_radius_bottom_left(): number { return this.getCornerRadius(CORNER_BOTTOM_LEFT); }
  set corner_radius_bottom_left(value: number) { this.setCornerRadius(CORNER_BOTTOM_LEFT, value); }
  get corner_detail(): number { return this.cornerDetail; }
  set corner_detail(value: number) { this.setCornerDetail(value); }
  get expand_margin_left(): number { return this.getExpandMargin(SIDE_LEFT); }
  set expand_margin_left(value: number) { this.setExpandMargin(SIDE_LEFT, value); }
  get expand_margin_top(): number { return this.getExpandMargin(SIDE_TOP); }
  set expand_margin_top(value: number) { this.setExpandMargin(SIDE_TOP, value); }
  get expand_margin_right(): number { return this.getExpandMargin(SIDE_RIGHT); }
  set expand_margin_right(value: number) { this.setExpandMargin(SIDE_RIGHT, value); }
  get expand_margin_bottom(): number { return this.getExpandMargin(SIDE_BOTTOM); }
  set expand_margin_bottom(value: number) { this.setExpandMargin(SIDE_BOTTOM, value); }
  get draw_center(): boolean { return this.drawCenter; }
  set draw_center(value: boolean) { this.setDrawCenter(value); }
  get shadow_color(): ColorValue { return this.getShadowColor(); }
  set shadow_color(value: ColorValue) { this.setShadowColor(value); }
  get shadow_size(): number { return this.shadowSize; }
  set shadow_size(value: number) { this.setShadowSize(value); }
  get shadow_offset(): GodotPoint2 { return this.getShadowOffset(); }
  set shadow_offset(value: GodotPoint2) { this.setShadowOffset(value); }
  get anti_aliasing(): boolean { return this.antiAliased; }
  set anti_aliasing(value: boolean) { this.setAntiAliased(value); }
  get anti_aliasing_size(): number { return this.antiAliasingSize; }
  set anti_aliasing_size(value: number) { this.setAntiAliasingSize(value); }
}

export function colorCss(color: ColorValue): string {
  if (
    [color.r, color.g, color.b, color.a].some(
      (channel) => !Number.isFinite(channel) || channel < 0 || channel > 1,
    )
  ) {
    throw new RangeError(
      'godot-compat: native CSS StyleBox colors cannot preserve channels outside [0, 1].',
    );
  }
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
}

export function createStyleBoxEmpty(value?: {
  readonly contentMargin?: readonly [number, number, number, number];
}): GodotStyleBoxEmpty {
  const style = new GodotStyleBoxEmpty();
  if (value?.contentMargin !== undefined) {
    style.setContentMarginIndividual(...value.contentMargin);
  }
  return style;
}

export function createStyleBox(value?: {
  readonly contentMargin?: readonly [number, number, number, number];
}): GodotStyleBox {
  const style = new GodotStyleBox();
  if (value?.contentMargin !== undefined) {
    style.setContentMarginIndividual(...value.contentMargin);
  }
  return style;
}

export function createStyleBoxLine(value: {
  readonly contentMargin?: readonly [number, number, number, number];
  readonly color?: ColorValue;
  readonly thickness?: number;
  readonly vertical?: boolean;
  readonly growBegin?: number;
  readonly growEnd?: number;
} = {}): GodotStyleBoxLine {
  const style = new GodotStyleBoxLine();
  if (value.contentMargin !== undefined) style.setContentMarginIndividual(...value.contentMargin);
  if (value.color !== undefined) style.setColor(value.color);
  if (value.thickness !== undefined) style.setThickness(value.thickness);
  if (value.vertical !== undefined) style.setVertical(value.vertical);
  if (value.growBegin !== undefined) style.setGrowBegin(value.growBegin);
  if (value.growEnd !== undefined) style.setGrowEnd(value.growEnd);
  return style;
}

export function createStyleBoxTexture<TextureValue = unknown>(value: {
  readonly contentMargin?: readonly [number, number, number, number];
  readonly texture?: TextureValue | null;
  readonly textureMargin?: readonly [number, number, number, number];
  readonly expandMargin?: readonly [number, number, number, number];
  readonly regionRect?: GodotRect2;
  readonly drawCenter?: boolean;
  readonly modulate?: ColorValue;
  readonly horizontalAxisStretchMode?: number;
  readonly verticalAxisStretchMode?: number;
} = {}): GodotStyleBoxTexture<TextureValue> {
  const style = new GodotStyleBoxTexture<TextureValue>();
  if (value.contentMargin !== undefined) style.setContentMarginIndividual(...value.contentMargin);
  if (value.texture !== undefined) style.setTexture(value.texture);
  if (value.textureMargin !== undefined) style.setTextureMarginIndividual(...value.textureMargin);
  if (value.expandMargin !== undefined) style.setExpandMarginIndividual(...value.expandMargin);
  if (value.regionRect !== undefined) style.setRegionRect(value.regionRect);
  if (value.drawCenter !== undefined) style.setDrawCenter(value.drawCenter);
  if (value.modulate !== undefined) style.setModulate(value.modulate);
  if (value.horizontalAxisStretchMode !== undefined) {
    style.setHorizontalAxisStretchMode(value.horizontalAxisStretchMode);
  }
  if (value.verticalAxisStretchMode !== undefined) {
    style.setVerticalAxisStretchMode(value.verticalAxisStretchMode);
  }
  return style;
}

export function createStyleBoxFlat(value: {
  readonly contentMargin?: readonly [number, number, number, number];
  readonly backgroundColor?: ColorValue;
  readonly borderColor?: ColorValue;
  readonly borderWidth?: readonly [number, number, number, number];
  readonly cornerRadius?: readonly [number, number, number, number];
  readonly cornerDetail?: number;
  readonly expandMargin?: readonly [number, number, number, number];
  readonly drawCenter?: boolean;
  readonly antiAliased?: boolean;
  readonly antiAliasingSize?: number;
  readonly shadowColor?: ColorValue;
  readonly shadowSize?: number;
  readonly shadowOffset?: GodotPoint2;
} = {}): GodotStyleBoxFlat {
  const style = new GodotStyleBoxFlat();
  if (value.contentMargin !== undefined) style.setContentMarginIndividual(...value.contentMargin);
  if (value.backgroundColor !== undefined) style.setBackgroundColor(value.backgroundColor);
  if (value.borderColor !== undefined) style.setBorderColor(value.borderColor);
  if (value.borderWidth !== undefined) {
    value.borderWidth.forEach((width, side) => style.setBorderWidth(side, width));
  }
  if (value.cornerRadius !== undefined) style.setCornerRadiusIndividual(...value.cornerRadius);
  if (value.cornerDetail !== undefined) style.setCornerDetail(value.cornerDetail);
  if (value.expandMargin !== undefined) style.setExpandMarginIndividual(...value.expandMargin);
  if (value.drawCenter !== undefined) style.setDrawCenter(value.drawCenter);
  if (value.antiAliased !== undefined) style.setAntiAliased(value.antiAliased);
  if (value.antiAliasingSize !== undefined) style.setAntiAliasingSize(value.antiAliasingSize);
  if (value.shadowColor !== undefined) style.setShadowColor(value.shadowColor);
  if (value.shadowSize !== undefined) style.setShadowSize(value.shadowSize);
  if (value.shadowOffset !== undefined) style.setShadowOffset(value.shadowOffset);
  return style;
}

export function styleBoxCss(
  style: GodotStyleBox,
  options: { readonly contentPadding?: boolean } = {},
): GodotStyleBoxCss {
  const drawn = style.drawCss();
  if (options.contentPadding !== true) return drawn;
  const left = style.getMargin(SIDE_LEFT);
  const top = style.getMargin(SIDE_TOP);
  const right = style.getMargin(SIDE_RIGHT);
  const bottom = style.getMargin(SIDE_BOTTOM);
  const borders =
    style instanceof GodotStyleBoxFlat
      ? style.borderWidth
      : style instanceof GodotStyleBoxTexture
        ? style.textureMargin
        : ([0, 0, 0, 0] as const);
  const padding = [left, top, right, bottom].map((margin, side) => margin - borders[side]!);
  if (padding.some((value) => value < 0)) {
    throw new Error(
      'godot-compat: StyleBox content margins inside the border require an inner positioned layer; native CSS padding cannot preserve them.',
    );
  }
  return {
    ...drawn,
    padding: `${padding[1]}px ${padding[2]}px ${padding[3]}px ${padding[0]}px`,
  };
}

function pixiColor(color: ColorValue): { readonly color: number; readonly alpha: number } {
  if (
    [color.r, color.g, color.b, color.a].some(
      (channel) => !Number.isFinite(channel) || channel < 0 || channel > 1,
    )
  ) {
    throw new RangeError(
      'godot-compat: native Pixi StyleBox colors cannot preserve channels outside [0, 1].',
    );
  }
  const channel = (value: number): number => Math.round(value * 255);
  return {
    color: (channel(color.r) << 16) | (channel(color.g) << 8) | channel(color.b),
    alpha: color.a,
  };
}

/** Draw a StyleBox on the retained Pixi Graphics that is the Control entity. */
export function drawStyleBoxPixi(
  graphics: Graphics,
  style: GodotStyleBox,
  width: number,
  height: number,
  originX = 0,
  originY = 0,
  clear = true,
): void {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(originX) ||
    !Number.isFinite(originY) ||
    width < 0 ||
    height < 0
  ) {
    throw new RangeError(
      `godot-compat: StyleBox draw rect must be finite with non-negative size; received ` +
        `${originX},${originY},${width},${height}.`,
    );
  }
  if (clear) graphics.clear();
  if (style.constructor === GodotStyleBox) return;
  if (style instanceof GodotStyleBoxEmpty) return;
  if (style instanceof GodotStyleBoxLine) {
    const x = Math.trunc(originX + (style.vertical ? 0 : -style.growBegin));
    const y = Math.trunc(originY + (style.vertical ? -style.growBegin : 0));
    const lineWidth = style.vertical
      ? Math.trunc(style.thickness)
      : Math.trunc(Math.trunc(width) + style.growBegin + style.growEnd);
    const lineHeight = style.vertical
      ? Math.trunc(Math.trunc(height) + style.growBegin + style.growEnd)
      : Math.trunc(style.thickness);
    if (lineWidth > 0 && lineHeight > 0) {
      graphics.rect(x, y, lineWidth, lineHeight).fill(pixiColor(style.color));
    }
    return;
  }
  if (style instanceof GodotStyleBoxTexture) {
    if (style.getTexture() === null) return;
    throw new Error(
      'godot-compat: Pixi StyleBoxTexture requires a retained native nine-patch entity.',
    );
  }
  if (!(style instanceof GodotStyleBoxFlat)) {
    throw new Error(
      'godot-compat: Pixi StyleBox drawing received an unsupported StyleBox subclass.',
    );
  }
  if (style.cornerRadius.some((radius) => radius !== 0)) {
    throw new Error(
      'godot-compat: rounded StyleBoxFlat drawing requires Godot corner-detail tessellation.',
    );
  }
  if (style.shadowSize > 0) {
    throw new Error(
      'godot-compat: positive StyleBoxFlat shadows require Godot vertex-color fade geometry.',
    );
  }

  const [leftExpand, topExpand, rightExpand, bottomExpand] = style.expandMargin;
  const x = originX - leftExpand;
  const y = originY - topExpand;
  const outerWidth = width + leftExpand + rightExpand;
  const outerHeight = height + topExpand + bottomExpand;
  if (outerWidth < 0 || outerHeight < 0) {
    throw new Error(
      'godot-compat: signed StyleBox expand margins inverted the Pixi draw rectangle.',
    );
  }
  if (outerWidth === 0 || outerHeight === 0) return;

  const [authoredLeft, authoredTop, authoredRight, authoredBottom] = style.borderWidth;
  // Godot scales opposing widths down together when they cannot both fit the style rect
  // (`adapt_values`, style_box_flat.cpp). Keeping that step here prevents an oversized authored
  // border from collapsing a different side or changing the inner-corner calculation.
  const horizontalBorderScale = Math.min(
    1,
    outerWidth / Math.max(1, authoredLeft + authoredRight),
  );
  const verticalBorderScale = Math.min(
    1,
    outerHeight / Math.max(1, authoredTop + authoredBottom),
  );
  const left = authoredLeft * horizontalBorderScale;
  const right = authoredRight * horizontalBorderScale;
  const top = authoredTop * verticalBorderScale;
  const bottom = authoredBottom * verticalBorderScale;
  const hasBorder = left > 0 || top > 0 || right > 0 || bottom > 0;
  if (hasBorder) {
    graphics.rect(x, y, outerWidth, outerHeight).fill(pixiColor(style.borderColor));
  }

  const innerX = x + left;
  const innerY = y + top;
  const innerWidth = Math.max(0, outerWidth - left - right);
  const innerHeight = Math.max(0, outerHeight - top - bottom);
  if (innerWidth === 0 || innerHeight === 0) return;
  if (style.drawCenter) {
    graphics
      .rect(innerX, innerY, innerWidth, innerHeight)
      .fill(pixiColor(style.backgroundColor));
  } else if (hasBorder) {
    graphics.rect(innerX, innerY, innerWidth, innerHeight).cut();
  }
}

/** StyleBox.draw(canvas_item, rect) appended to the CanvasItem's current native draw list. */
export function drawStyleBoxPixiOnCanvasItem(
  style: GodotStyleBox,
  canvasItem: GodotRid,
  rect: GodotRect2,
): void {
  if (
    typeof rect !== 'object' ||
    rect === null ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
  ) {
    throw new TypeError('godot-compat: StyleBox.draw rect must be a finite Rect2.');
  }
  drawStyleBoxPixi(
    godotCanvasDrawingTarget(canvasItem),
    style,
    rect.width,
    rect.height,
    rect.x,
    rect.y,
    false,
  );
}

export function noStyleBoxCss(): GodotStyleBoxCss {
  return createStyleBoxEmpty().drawCss();
}

export const STYLEBOX_FALLBACK_COLOR = transparentBlack();
