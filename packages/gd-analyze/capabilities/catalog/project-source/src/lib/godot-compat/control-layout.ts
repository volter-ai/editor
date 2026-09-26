/** Exact retained Control layout and focus APIs shared by DOM and Pixi controls. */

import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { optionalControlBinding, type ControlPoint } from './control-state';
import { godotOsGetLocale } from './os';
import { godotTextServerIsLocaleRightToLeft } from './text-server';
import { godotTranslationGetLocale } from './translation-server';
import {
  godotNodePathNew,
  isGodotNodePath,
  type GodotNodePath,
} from './node-path';

interface NativeControlLike {
  width?: number;
  height?: number;
  parent?: unknown;
  children?: readonly unknown[];
  visible?: boolean;
  eventMode?: string;
}

interface ControlLayoutState {
  focusNeighbors: Map<number, GodotNodePath>;
  focusNext: GodotNodePath;
  focusPrevious: GodotNodePath;
  layoutDirection: number;
  layoutDirectionMaximum: 3 | 4;
  growHorizontal: number;
  growVertical: number;
  clipContents: boolean;
  blockMinimumSizeAdjustment: boolean;
  minimumSizeChanged?: SignalHandle<readonly []>;
  layoutDirectionChanged?: Set<() => void>;
  retainedParent?: () => object | null;
  retainedChildren?: () => readonly object[];
}

const LAYOUTS = new WeakMap<object, ControlLayoutState>();

function state(control: object): ControlLayoutState {
  let value = LAYOUTS.get(control);
  if (value === undefined) {
    value = {
      focusNeighbors: new Map(),
      focusNext: godotNodePathNew(),
      focusPrevious: godotNodePathNew(),
      layoutDirection: 0,
      layoutDirectionMaximum: 4,
      growHorizontal: 1,
      growVertical: 1,
      clipContents: false,
      blockMinimumSizeAdjustment: false,
    };
    LAYOUTS.set(control, value);
  }
  return value;
}

function finitePoint(value: ControlPoint, member: string): ControlPoint {
  if (typeof value !== 'object' || value === null || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError(`${member} requires a finite Vector2.`);
  }
  return { x: value.x, y: value.y };
}

function enumValue(value: number, minimum: number, maximum: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function nodePath(value: string | GodotNodePath, member: string): GodotNodePath {
  if (typeof value === 'string') return godotNodePathNew(value);
  if (!isGodotNodePath(value)) throw new TypeError(`${member} requires a NodePath value.`);
  return godotNodePathNew(value);
}

function nativeSize(control: object): ControlPoint {
  const binding = optionalControlBinding(control);
  if (binding !== undefined) {
    const record = binding.state.read(binding.id);
    const authored = binding.state.authored(binding.id);
    const size = record.size ?? authored?.size;
    if (size !== undefined) return { x: size.x, y: size.y };
  }
  const native = control as NativeControlLike;
  return {
    x: typeof native.width === 'number' && Number.isFinite(native.width) ? native.width : 0,
    y: typeof native.height === 'number' && Number.isFinite(native.height) ? native.height : 0,
  };
}

/** The class minimum plus custom_minimum_size, as Godot exposes through the public getter. */
export function getControlCombinedMinimumSize(control: object): ControlPoint {
  const binding = optionalControlBinding(control);
  const intrinsic = getControlMinimumSize(control);
  if (binding === undefined) return intrinsic;
  const record = binding.state.read(binding.id);
  const authored = binding.state.authored(binding.id);
  const custom = record.custom_minimum_size ?? authored?.custom_minimum_size ?? { x: 0, y: 0 };
  return { x: Math.max(intrinsic.x, custom.x), y: Math.max(intrinsic.y, custom.y) };
}

/** Read renderer-owned intrinsic content bounds without creating a mirror node. */
export function getControlMinimumSize(control: object): ControlPoint {
  const native = control as NativeControlLike;
  const width = typeof native.width === 'number' && Number.isFinite(native.width) ? native.width : 0;
  const height = typeof native.height === 'number' && Number.isFinite(native.height) ? native.height : 0;
  return { x: Math.max(0, width), y: Math.max(0, height) };
}

export function getControlMinimumSizeChangedSignal(control: object): GodotSignal<readonly []> {
  const layout = state(control);
  layout.minimumSizeChanged ??= createSignal<readonly []>();
  return layout.minimumSizeChanged.signal;
}

/** Notify native container layout after content which affects minimum size changes. */
export function controlMinimumSizeChanged(control: object): void {
  const layout = state(control);
  layout.minimumSizeChanged?.emit();
  if (layout.blockMinimumSizeAdjustment) return;
  const binding = optionalControlBinding(control);
  if (binding === undefined) return;
  const minimum = getControlCombinedMinimumSize(control);
  const current = nativeSize(control);
  binding.state.write(binding.id, {
    size: { x: Math.max(current.x, minimum.x), y: Math.max(current.y, minimum.y) },
  });
}

export function resetControlSize(control: object): void {
  const binding = optionalControlBinding(control);
  const minimum = getControlCombinedMinimumSize(control);
  if (binding !== undefined) binding.state.write(binding.id, { size: minimum });
  const native = control as NativeControlLike;
  if ('width' in native) native.width = minimum.x;
  if ('height' in native) native.height = minimum.y;
}

export function setControlBlockMinimumSizeAdjustment(control: object, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Control.set_block_minimum_size_adjustment requires a bool.');
  const layout = state(control);
  const wasBlocked = layout.blockMinimumSizeAdjustment;
  layout.blockMinimumSizeAdjustment = value;
  if (wasBlocked && !value) controlMinimumSizeChanged(control);
}

export function isControlMinimumSizeAdjustmentBlocked(control: object): boolean {
  return state(control).blockMinimumSizeAdjustment;
}

export function setControlFocusNeighbor(control: object, side: number, path: string | GodotNodePath): void {
  state(control).focusNeighbors.set(enumValue(side, 0, 3, 'Control.set_focus_neighbor side'), nodePath(path, 'Control.set_focus_neighbor'));
}

export function getControlFocusNeighbor(control: object, side: number): GodotNodePath {
  return godotNodePathNew(
    state(control).focusNeighbors.get(enumValue(side, 0, 3, 'Control.get_focus_neighbor side')) ?? '',
  );
}

export function setControlFocusNext(control: object, path: string | GodotNodePath): void {
  state(control).focusNext = nodePath(path, 'Control.set_focus_next');
}

export function getControlFocusNext(control: object): GodotNodePath {
  return godotNodePathNew(state(control).focusNext);
}

export function setControlFocusPrevious(control: object, path: string | GodotNodePath): void {
  state(control).focusPrevious = nodePath(path, 'Control.set_focus_previous');
}

export function getControlFocusPrevious(control: object): GodotNodePath {
  return godotNodePathNew(state(control).focusPrevious);
}

function applyNativeLayoutDirection(control: object): void {
  const layout = state(control);
  const rtl = isControlLayoutRtl(control);
  const binding = optionalControlBinding(control);
  const record = binding?.state.read(binding.id);
  for (const element of [record?.presentationElement, record?.focusElement]) {
    if (element !== undefined && element !== null) element.dir = rtl ? 'rtl' : 'ltr';
  }
}

function notifyLayoutDirectionChanged(control: object): void {
  const layout = state(control);
  applyNativeLayoutDirection(control);
  for (const changed of layout.layoutDirectionChanged ?? []) changed();
  if (layout.retainedChildren !== undefined) {
    for (const child of layout.retainedChildren()) notifyLayoutDirectionChanged(child);
    return;
  }
  for (const child of (control as NativeControlLike).children ?? []) {
    if (typeof child !== 'object' || child === null) continue;
    if (LAYOUTS.has(child)) notifyLayoutDirectionChanged(child);
    else notifyLayoutDirectionDescendants(child as NativeControlLike);
  }
}

function notifyLayoutDirectionDescendants(native: NativeControlLike): void {
  for (const child of native.children ?? []) {
    if (typeof child !== 'object' || child === null) continue;
    if (LAYOUTS.has(child)) notifyLayoutDirectionChanged(child);
    else notifyLayoutDirectionDescendants(child as NativeControlLike);
  }
}

export function setControlLayoutDirection(control: object, value: number, maximum?: 3 | 4): void {
  const layout = state(control);
  if (maximum !== undefined) layout.layoutDirectionMaximum = maximum;
  layout.layoutDirection = enumValue(value, 0, layout.layoutDirectionMaximum, 'Control.layout_direction');
  notifyLayoutDirectionChanged(control);
}

export function getControlLayoutDirection(control: object): number {
  return state(control).layoutDirection;
}

/** Control::is_layout_rtl, including inherited, application-locale and system-locale modes. */
export function isControlLayoutRtl(control: object): boolean {
  const layout = state(control);
  const direction = layout.layoutDirection;
  if (direction === 2) return false;
  if (direction === 3) return true;
  if (direction === 1) return godotTextServerIsLocaleRightToLeft(godotTranslationGetLocale());
  if (direction === 4) return godotTextServerIsLocaleRightToLeft(godotOsGetLocale());
  let parent = layout.retainedParent?.() ?? (control as NativeControlLike).parent;
  while (typeof parent === 'object' && parent !== null) {
    if (LAYOUTS.has(parent)) return isControlLayoutRtl(parent);
    parent = (parent as NativeControlLike).parent;
  }
  return godotTextServerIsLocaleRightToLeft(godotTranslationGetLocale());
}

/** Bind a DOM Control handle to the exact authored ControlState hierarchy already retaining it. */
export function bindControlLayoutStateHierarchy(control: object): void {
  const binding = optionalControlBinding(control);
  if (binding === undefined) {
    throw new Error('Control layout hierarchy requires an existing retained ControlState binding.');
  }
  const layout = state(control);
  layout.retainedParent = () => {
    const parentId = binding.state.authored(binding.id)?.parentId;
    return parentId === undefined ? null : binding.state.control(parentId) ?? null;
  };
  layout.retainedChildren = () => binding.state.childControls(binding.id);
}

/** Retain native container invalidation on effective layout-direction changes. */
export function bindControlLayoutDirectionChanged(control: object, changed: () => void): () => void {
  const layout = state(control);
  layout.layoutDirectionChanged ??= new Set();
  layout.layoutDirectionChanged.add(changed);
  return () => layout.layoutDirectionChanged?.delete(changed);
}

export function setControlGrowHorizontal(control: object, value: number): void {
  state(control).growHorizontal = enumValue(value, 0, 2, 'Control.grow_horizontal');
}

export function getControlGrowHorizontal(control: object): number {
  return state(control).growHorizontal;
}

export function setControlGrowVertical(control: object, value: number): void {
  state(control).growVertical = enumValue(value, 0, 2, 'Control.grow_vertical');
}

export function getControlGrowVertical(control: object): number {
  return state(control).growVertical;
}

export function setControlClipContents(control: object, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Control.clip_contents requires a bool.');
  state(control).clipContents = value;
  const binding = optionalControlBinding(control);
  const element = binding?.state.read(binding.id).focusElement;
  if (element !== undefined && element !== null) element.style.overflow = value ? 'hidden' : '';
  Reflect.set(control, 'mask', value ? Reflect.get(control, 'mask') ?? null : null);
}

export function getControlClipContents(control: object): boolean {
  return state(control).clipContents;
}
