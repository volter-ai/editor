/**
 * Godot 4 LabelSettings resource backed directly by Pixi TextStyle.
 *
 * Defaults and mutation ordering follow `scene/resources/label_settings.{h,cpp}` at the pinned
 * Godot source commit. The resource retains Godot's complete stacked outline/shadow data even
 * where Pixi can render only the first layer through one TextStyle; consumers can compose the
 * returned native styles as separate Text draws when every authored stack must be visible.
 */

import { TextStyle, type TextStyleOptions } from 'pixi.js';
import { godotColor } from './color';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
  hasGodotResourceProtocol,
} from './resource-io';
import type { GodotConnection } from './signal';
import type { ColorValue } from './variant';
import { type Vector2, vec2 } from './vector2';

export interface GodotFontResource {
  readonly family: string;
  readonly source?: string | ArrayBuffer;
  readonly descriptors?: FontFaceDescriptors;
}

export interface LabelOutlineLayer {
  size: number;
  color: ColorValue;
}

export interface LabelShadowLayer {
  offset: Vector2;
  color: ColorValue;
  outlineSize: number;
}

export interface GodotLabelSettings {
  lineSpacing: number;
  paragraphSpacing: number;
  font: GodotFontResource | null;
  fontSize: number;
  fontColor: ColorValue;
  outlineSize: number;
  outlineColor: ColorValue;
  shadowSize: number;
  shadowColor: ColorValue;
  shadowOffset: Vector2;
  readonly stackedOutlines: LabelOutlineLayer[];
  readonly stackedShadows: LabelShadowLayer[];
}

const LABEL_SETTINGS_IDENTITIES = new WeakSet<object>();
const LABEL_SETTINGS_FONTS = new WeakMap<object, GodotFontResource | null>();
const LABEL_SETTINGS_FONT_CONNECTIONS = new WeakMap<object, GodotConnection>();

export function isGodotLabelSettings(value: unknown): value is GodotLabelSettings {
  return typeof value === 'object' && value !== null && LABEL_SETTINGS_IDENTITIES.has(value);
}

const WHITE = godotColor(1, 1, 1, 1);
const BLACK = godotColor(0, 0, 0, 1);
const TRANSPARENT_BLACK = godotColor(0, 0, 0, 0);

function copyColor(color: ColorValue): ColorValue {
  return godotColor(color.r, color.g, color.b, color.a);
}

function copyOffset(offset: Vector2): Vector2 {
  return vec2(offset.x, offset.y);
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new Error(`LabelSettings.${member} requires a finite number.`);
  return value;
}

function nonNegativeInteger(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`LabelSettings.${member} requires a non-negative integer.`);
  }
  return value;
}

function requireIndex<T>(values: readonly T[], index: number, member: string): T {
  if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) {
    throw new Error(`LabelSettings.${member} index ${String(index)} is out of range.`);
  }
  return values[index]!;
}

function insertIndex<T>(values: T[], index: number, value: T, member: string): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > values.length) {
    throw new Error(`LabelSettings.${member} index ${String(index)} is out of range.`);
  }
  values.splice(index, 0, value);
}

function moveIndex<T>(values: T[], from: number, to: number, member: string): void {
  const value = requireIndex(values, from, member);
  if (!Number.isSafeInteger(to) || to < 0 || to >= values.length) {
    throw new Error(`LabelSettings.${member} destination ${String(to)} is out of range.`);
  }
  values.splice(from, 1);
  values.splice(to, 0, value);
}

export function createGodotLabelSettings(): GodotLabelSettings {
  const settings: GodotLabelSettings = {
    lineSpacing: 3,
    paragraphSpacing: 0,
    font: null,
    fontSize: 16,
    fontColor: copyColor(WHITE),
    outlineSize: 0,
    outlineColor: copyColor(BLACK),
    shadowSize: 0,
    shadowColor: copyColor(TRANSPARENT_BLACK),
    shadowOffset: vec2(1, 1),
    stackedOutlines: [],
    stackedShadows: [],
  };
  registerGodotObjectIdentity(settings, 'LabelSettings');
  LABEL_SETTINGS_IDENTITIES.add(settings);
  LABEL_SETTINGS_FONTS.set(settings, null);
  Object.defineProperties(settings, {
    line_spacing: { enumerable: true, configurable: true, get: () => settings.lineSpacing, set: (value: number) => setLabelLineSpacing(settings, value) },
    paragraph_spacing: { enumerable: true, configurable: true, get: () => settings.paragraphSpacing, set: (value: number) => setLabelParagraphSpacing(settings, value) },
    font: { enumerable: true, configurable: true, get: () => getLabelFont(settings), set: (value: GodotFontResource | null) => setLabelFont(settings, value) },
    font_size: { enumerable: true, configurable: true, get: () => settings.fontSize, set: (value: number) => setLabelFontSize(settings, value) },
    font_color: { enumerable: true, configurable: true, get: () => getLabelFontColor(settings), set: (value: ColorValue) => setLabelFontColor(settings, value) },
    outline_size: { enumerable: true, configurable: true, get: () => settings.outlineSize, set: (value: number) => setLabelOutlineSize(settings, value) },
    outline_color: { enumerable: true, configurable: true, get: () => getLabelOutlineColor(settings), set: (value: ColorValue) => setLabelOutlineColor(settings, value) },
    shadow_size: { enumerable: true, configurable: true, get: () => settings.shadowSize, set: (value: number) => setLabelShadowSize(settings, value) },
    shadow_color: { enumerable: true, configurable: true, get: () => getLabelShadowColor(settings), set: (value: ColorValue) => setLabelShadowColor(settings, value) },
    shadow_offset: { enumerable: true, configurable: true, get: () => getLabelShadowOffset(settings), set: (value: Vector2) => setLabelShadowOffset(settings, value) },
  });
  Object.assign(settings, {
    set_line_spacing: (value: number): void => setLabelLineSpacing(settings, value),
    get_line_spacing: (): number => getLabelLineSpacing(settings),
    set_paragraph_spacing: (value: number): void => setLabelParagraphSpacing(settings, value),
    get_paragraph_spacing: (): number => getLabelParagraphSpacing(settings),
    set_font: (value: GodotFontResource | null): void => setLabelFont(settings, value),
    get_font: (): GodotFontResource | null => getLabelFont(settings),
    set_font_size: (value: number): void => setLabelFontSize(settings, value),
    get_font_size: (): number => getLabelFontSize(settings),
    set_font_color: (value: ColorValue): void => setLabelFontColor(settings, value),
    get_font_color: (): ColorValue => getLabelFontColor(settings),
    set_outline_size: (value: number): void => setLabelOutlineSize(settings, value),
    get_outline_size: (): number => getLabelOutlineSize(settings),
    set_outline_color: (value: ColorValue): void => setLabelOutlineColor(settings, value),
    get_outline_color: (): ColorValue => getLabelOutlineColor(settings),
    set_shadow_size: (value: number): void => setLabelShadowSize(settings, value),
    get_shadow_size: (): number => getLabelShadowSize(settings),
    set_shadow_color: (value: ColorValue): void => setLabelShadowColor(settings, value),
    get_shadow_color: (): ColorValue => getLabelShadowColor(settings),
    set_shadow_offset: (value: Vector2): void => setLabelShadowOffset(settings, value),
    get_shadow_offset: (): Vector2 => getLabelShadowOffset(settings),
    get_stacked_outline_count: (): number => getStackedOutlineCount(settings),
    set_stacked_outline_count: (value: number): void => setStackedOutlineCount(settings, value),
    add_stacked_outline: (index: number): void => addStackedOutline(settings, index),
    move_stacked_outline: (from: number, to: number): void => moveStackedOutline(settings, from, to),
    remove_stacked_outline: (index: number): void => removeStackedOutline(settings, index),
    set_stacked_outline_size: (index: number, value: number): void => setStackedOutlineSize(settings, index, value),
    get_stacked_outline_size: (index: number): number => getStackedOutlineSize(settings, index),
    set_stacked_outline_color: (index: number, value: ColorValue): void => setStackedOutlineColor(settings, index, value),
    get_stacked_outline_color: (index: number): ColorValue => getStackedOutlineColor(settings, index),
    get_stacked_shadow_count: (): number => getStackedShadowCount(settings),
    set_stacked_shadow_count: (value: number): void => setStackedShadowCount(settings, value),
    add_stacked_shadow: (index: number): void => addStackedShadow(settings, index),
    move_stacked_shadow: (from: number, to: number): void => moveStackedShadow(settings, from, to),
    remove_stacked_shadow: (index: number): void => removeStackedShadow(settings, index),
    set_stacked_shadow_offset: (index: number, value: Vector2): void => setStackedShadowOffset(settings, index, value),
    get_stacked_shadow_offset: (index: number): Vector2 => getStackedShadowOffset(settings, index),
    set_stacked_shadow_color: (index: number, value: ColorValue): void => setStackedShadowColor(settings, index, value),
    get_stacked_shadow_color: (index: number): ColorValue => getStackedShadowColor(settings, index),
    set_stacked_shadow_outline_size: (index: number, value: number): void => setStackedShadowOutlineSize(settings, index, value),
    get_stacked_shadow_outline_size: (index: number): number => getStackedShadowOutlineSize(settings, index),
  });
  return bindGodotResourceProtocol(settings, {
    createDuplicate(source) {
      const copy = createGodotLabelSettings();
      copy.lineSpacing = source.lineSpacing;
      copy.paragraphSpacing = source.paragraphSpacing;
      copy.fontSize = source.fontSize;
      copy.fontColor = copyColor(source.fontColor);
      copy.outlineSize = source.outlineSize;
      copy.outlineColor = copyColor(source.outlineColor);
      copy.shadowSize = source.shadowSize;
      copy.shadowColor = copyColor(source.shadowColor);
      copy.shadowOffset = copyOffset(source.shadowOffset);
      copy.stackedOutlines.push(...source.stackedOutlines.map((layer) => ({
        size: layer.size,
        color: copyColor(layer.color),
      })));
      copy.stackedShadows.push(...source.stackedShadows.map((layer) => ({
        offset: copyOffset(layer.offset),
        color: copyColor(layer.color),
        outlineSize: layer.outlineSize,
      })));
      return copy;
    },
    populateDuplicate(source, target, subresources, memo) {
      target.font = subresources ? duplicateGodotSubresource(source.font, memo) : source.font;
    },
  });
}

export function setLabelLineSpacing(settings: GodotLabelSettings, spacing: number): void {
  settings.lineSpacing = finite(spacing, 'set_line_spacing');
  godotResourceEmitChanged(settings);
}

export const getLabelLineSpacing = (settings: GodotLabelSettings): number => settings.lineSpacing;

export function setLabelParagraphSpacing(settings: GodotLabelSettings, spacing: number): void {
  settings.paragraphSpacing = finite(spacing, 'set_paragraph_spacing');
  godotResourceEmitChanged(settings);
}

export const getLabelParagraphSpacing = (settings: GodotLabelSettings): number => settings.paragraphSpacing;

export function setLabelFont(settings: GodotLabelSettings, font: GodotFontResource | null): void {
  if (
    font !== null &&
    (typeof font !== 'object' || typeof font.family !== 'string' || font.family.length === 0)
  ) {
    throw new TypeError('LabelSettings.font requires a Font Resource or null.');
  }
  if (LABEL_SETTINGS_FONTS.get(settings) === font) return;
  LABEL_SETTINGS_FONT_CONNECTIONS.get(settings)?.disconnect();
  LABEL_SETTINGS_FONT_CONNECTIONS.delete(settings);
  LABEL_SETTINGS_FONTS.set(settings, font);
  if (font !== null && hasGodotResourceProtocol(font)) {
    LABEL_SETTINGS_FONT_CONNECTIONS.set(
      settings,
      godotResourceChangedSignal(font).connect(() => godotResourceEmitChanged(settings)),
    );
  }
  godotResourceEmitChanged(settings);
}

export const getLabelFont = (settings: GodotLabelSettings): GodotFontResource | null =>
  LABEL_SETTINGS_FONTS.get(settings) ?? null;

export function setLabelFontSize(settings: GodotLabelSettings, size: number): void {
  settings.fontSize = nonNegativeInteger(size, 'set_font_size');
  godotResourceEmitChanged(settings);
}

export const getLabelFontSize = (settings: GodotLabelSettings): number => settings.fontSize;

export function setLabelFontColor(settings: GodotLabelSettings, color: ColorValue): void {
  settings.fontColor = copyColor(color);
  godotResourceEmitChanged(settings);
}

export const getLabelFontColor = (settings: GodotLabelSettings): ColorValue => copyColor(settings.fontColor);

export function setLabelOutlineSize(settings: GodotLabelSettings, size: number): void {
  settings.outlineSize = nonNegativeInteger(size, 'set_outline_size');
  godotResourceEmitChanged(settings);
}

export const getLabelOutlineSize = (settings: GodotLabelSettings): number => settings.outlineSize;

export function setLabelOutlineColor(settings: GodotLabelSettings, color: ColorValue): void {
  settings.outlineColor = copyColor(color);
  godotResourceEmitChanged(settings);
}

export const getLabelOutlineColor = (settings: GodotLabelSettings): ColorValue => copyColor(settings.outlineColor);

export function setLabelShadowSize(settings: GodotLabelSettings, size: number): void {
  settings.shadowSize = nonNegativeInteger(size, 'set_shadow_size');
  godotResourceEmitChanged(settings);
}

export const getLabelShadowSize = (settings: GodotLabelSettings): number => settings.shadowSize;

export function setLabelShadowColor(settings: GodotLabelSettings, color: ColorValue): void {
  settings.shadowColor = copyColor(color);
  godotResourceEmitChanged(settings);
}

export const getLabelShadowColor = (settings: GodotLabelSettings): ColorValue => copyColor(settings.shadowColor);

export function setLabelShadowOffset(settings: GodotLabelSettings, offset: Vector2): void {
  settings.shadowOffset = copyOffset(offset);
  godotResourceEmitChanged(settings);
}

export const getLabelShadowOffset = (settings: GodotLabelSettings): Vector2 => copyOffset(settings.shadowOffset);

export const getStackedOutlineCount = (settings: GodotLabelSettings): number => settings.stackedOutlines.length;

export function setStackedOutlineCount(settings: GodotLabelSettings, count: number): void {
  nonNegativeInteger(count, 'set_stacked_outline_count');
  while (settings.stackedOutlines.length < count) {
    settings.stackedOutlines.push({ size: 0, color: copyColor(BLACK) });
  }
  settings.stackedOutlines.length = count;
  godotResourceEmitChanged(settings);
}

export function addStackedOutline(settings: GodotLabelSettings, index: number): void {
  insertIndex(settings.stackedOutlines, index, { size: 0, color: copyColor(BLACK) }, 'add_stacked_outline');
  godotResourceEmitChanged(settings);
}

export function moveStackedOutline(settings: GodotLabelSettings, from: number, to: number): void {
  moveIndex(settings.stackedOutlines, from, to, 'move_stacked_outline');
  godotResourceEmitChanged(settings);
}

export function removeStackedOutline(settings: GodotLabelSettings, index: number): void {
  requireIndex(settings.stackedOutlines, index, 'remove_stacked_outline');
  settings.stackedOutlines.splice(index, 1);
  godotResourceEmitChanged(settings);
}

export function setStackedOutlineSize(settings: GodotLabelSettings, index: number, size: number): void {
  requireIndex(settings.stackedOutlines, index, 'set_stacked_outline_size').size = nonNegativeInteger(size, 'set_stacked_outline_size');
  godotResourceEmitChanged(settings);
}

export const getStackedOutlineSize = (settings: GodotLabelSettings, index: number): number =>
  requireIndex(settings.stackedOutlines, index, 'get_stacked_outline_size').size;

export function setStackedOutlineColor(settings: GodotLabelSettings, index: number, color: ColorValue): void {
  requireIndex(settings.stackedOutlines, index, 'set_stacked_outline_color').color = copyColor(color);
  godotResourceEmitChanged(settings);
}

export const getStackedOutlineColor = (settings: GodotLabelSettings, index: number): ColorValue =>
  copyColor(requireIndex(settings.stackedOutlines, index, 'get_stacked_outline_color').color);

export const getStackedShadowCount = (settings: GodotLabelSettings): number => settings.stackedShadows.length;

export function setStackedShadowCount(settings: GodotLabelSettings, count: number): void {
  nonNegativeInteger(count, 'set_stacked_shadow_count');
  while (settings.stackedShadows.length < count) {
    settings.stackedShadows.push({ offset: vec2(1, 1), color: copyColor(TRANSPARENT_BLACK), outlineSize: 0 });
  }
  settings.stackedShadows.length = count;
  godotResourceEmitChanged(settings);
}

export function addStackedShadow(settings: GodotLabelSettings, index: number): void {
  insertIndex(settings.stackedShadows, index, {
    offset: vec2(1, 1), color: copyColor(TRANSPARENT_BLACK), outlineSize: 0,
  }, 'add_stacked_shadow');
  godotResourceEmitChanged(settings);
}

export function moveStackedShadow(settings: GodotLabelSettings, from: number, to: number): void {
  moveIndex(settings.stackedShadows, from, to, 'move_stacked_shadow');
  godotResourceEmitChanged(settings);
}

export function removeStackedShadow(settings: GodotLabelSettings, index: number): void {
  requireIndex(settings.stackedShadows, index, 'remove_stacked_shadow');
  settings.stackedShadows.splice(index, 1);
  godotResourceEmitChanged(settings);
}

export function setStackedShadowOffset(settings: GodotLabelSettings, index: number, offset: Vector2): void {
  requireIndex(settings.stackedShadows, index, 'set_stacked_shadow_offset').offset = copyOffset(offset);
  godotResourceEmitChanged(settings);
}

export const getStackedShadowOffset = (settings: GodotLabelSettings, index: number): Vector2 =>
  copyOffset(requireIndex(settings.stackedShadows, index, 'get_stacked_shadow_offset').offset);

export function setStackedShadowColor(settings: GodotLabelSettings, index: number, color: ColorValue): void {
  requireIndex(settings.stackedShadows, index, 'set_stacked_shadow_color').color = copyColor(color);
  godotResourceEmitChanged(settings);
}

export const getStackedShadowColor = (settings: GodotLabelSettings, index: number): ColorValue =>
  copyColor(requireIndex(settings.stackedShadows, index, 'get_stacked_shadow_color').color);

export function setStackedShadowOutlineSize(settings: GodotLabelSettings, index: number, size: number): void {
  requireIndex(settings.stackedShadows, index, 'set_stacked_shadow_outline_size').outlineSize =
    nonNegativeInteger(size, 'set_stacked_shadow_outline_size');
  godotResourceEmitChanged(settings);
}

export const getStackedShadowOutlineSize = (settings: GodotLabelSettings, index: number): number =>
  requireIndex(settings.stackedShadows, index, 'get_stacked_shadow_outline_size').outlineSize;

function cssColor(color: ColorValue): string {
  const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${Math.max(0, Math.min(1, color.a))})`;
}

/** Native Pixi style options for one LabelSettings layer. */
export function labelSettingsTextStyleOptions(settings: GodotLabelSettings): TextStyleOptions {
  return {
    ...(settings.font === null ? {} : { fontFamily: settings.font.family }),
    fontSize: settings.fontSize,
    fill: cssColor(settings.fontColor),
    lineHeight: settings.fontSize + settings.lineSpacing,
    ...(settings.outlineSize <= 0 ? {} : {
      stroke: { color: cssColor(settings.outlineColor), width: settings.outlineSize * 2 },
    }),
    ...(settings.shadowColor.a <= 0 ? {} : { dropShadow: {
      color: cssColor(settings.shadowColor),
      alpha: settings.shadowColor.a,
      angle: Math.atan2(settings.shadowOffset.y, settings.shadowOffset.x),
      distance: Math.hypot(settings.shadowOffset.x, settings.shadowOffset.y),
      blur: settings.shadowSize,
    } }),
  };
}

/** Construct the ecosystem-native style; callers continue using Pixi directly afterwards. */
export function createLabelTextStyle(settings: GodotLabelSettings): TextStyle {
  return new TextStyle(labelSettingsTextStyleOptions(settings));
}
