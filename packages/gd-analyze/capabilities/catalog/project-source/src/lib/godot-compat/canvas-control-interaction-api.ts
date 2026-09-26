/** Native focus, navigation, clipping, and tooltip vocabulary for retained canvas Controls. */

import { Container } from 'pixi.js';

import {
  getControlClipContents,
  getControlFocusNeighbor,
  getControlFocusNext,
  getControlFocusPrevious,
  getControlGrowHorizontal,
  getControlGrowVertical,
  getControlLayoutDirection,
  getControlMinimumSizeChangedSignal,
  isControlMinimumSizeAdjustmentBlocked,
  setControlBlockMinimumSizeAdjustment,
  setControlClipContents,
  setControlFocusNeighbor,
  setControlFocusNext,
  setControlFocusPrevious,
  setControlGrowHorizontal,
  setControlGrowVertical,
  setControlLayoutDirection,
  isControlLayoutRtl,
} from './control-layout';
import {
  getControlFocusMode,
  getControlFocusOwner,
  getControlMouseEnteredSignal,
  getControlTooltipText,
  grabControlClickFocus,
  grabControlFocus,
  hasControlFocus,
  releaseControlFocus,
  setControlFocusMode,
  setControlTooltipText,
} from './control-widgets';
import type { GodotNodePath } from './node-path';
import type { GodotSignal } from './signal';

export interface GodotCanvasControlInteractionApi {
  focus_mode: number;
  focus_neighbor_left: GodotNodePath;
  focus_neighbor_top: GodotNodePath;
  focus_neighbor_right: GodotNodePath;
  focus_neighbor_bottom: GodotNodePath;
  focus_next: GodotNodePath;
  focus_previous: GodotNodePath;
  layout_direction: number;
  grow_horizontal: number;
  grow_vertical: number;
  clip_contents: boolean;
  tooltip_text: string;
  hint_tooltip: string;
  readonly mouse_entered: GodotSignal<readonly []>;
  readonly minimum_size_changed: GodotSignal<readonly []>;
  set_focus_mode(value: number): void;
  get_focus_mode(): number;
  get_focus_mode_with_override(): number;
  find_next_valid_focus(): Container | null;
  find_prev_valid_focus(): Container | null;
  grab_focus(): void;
  grab_click_focus(): void;
  release_focus(): void;
  has_focus(): boolean;
  get_focus_owner(): object | null;
  set_focus_neighbor(side: number, path: string | GodotNodePath): void;
  get_focus_neighbor(side: number): GodotNodePath;
  set_focus_next(path: string | GodotNodePath): void;
  get_focus_next(): GodotNodePath;
  set_focus_previous(path: string | GodotNodePath): void;
  get_focus_previous(): GodotNodePath;
  set_layout_direction(value: number): void;
  get_layout_direction(): number;
  is_layout_rtl(): boolean;
  set_h_grow_direction(value: number): void;
  get_h_grow_direction(): number;
  set_v_grow_direction(value: number): void;
  get_v_grow_direction(): number;
  set_clip_contents(value: boolean): void;
  is_clipping_contents(): boolean;
  set_block_minimum_size_adjustment(value: boolean): void;
  is_block_minimum_size_adjustment_enabled(): boolean;
  set_tooltip_text(value: string): void;
  get_tooltip_text(): string;
  set_tooltip(value: string): void;
  get_tooltip(): string;
}

/** Seat Control's source-facing interaction API directly on the retained Pixi identity. */
export function bindGodotCanvasControlInteractionApi<T extends Container>(
  source: T,
): T & GodotCanvasControlInteractionApi {
  const control = source as T & GodotCanvasControlInteractionApi;
  const focusCandidates = (): Container[] => {
    let root: Container = control;
    while (root.parent !== null) root = root.parent;
    const candidates: Container[] = [];
    const visit = (node: Container): void => {
      if (node.visible && node.renderable && getControlFocusMode(node) !== 0) candidates.push(node);
      for (const child of node.children) if (child instanceof Container) visit(child);
    };
    visit(root);
    return candidates;
  };
  const adjacentFocus = (direction: -1 | 1): Container | null => {
    const candidates = focusCandidates();
    if (candidates.length === 0) return null;
    const index = candidates.indexOf(control);
    if (index < 0) return candidates[direction > 0 ? 0 : candidates.length - 1] ?? null;
    return candidates[(index + direction + candidates.length) % candidates.length] ?? null;
  };
  Object.defineProperties(control, {
    focus_mode: { configurable: true, enumerable: true, get: () => getControlFocusMode(control), set: (value: number) => setControlFocusMode(control, value) },
    focus_neighbor_left: { configurable: true, enumerable: true, get: () => getControlFocusNeighbor(control, 0), set: (value: string | GodotNodePath) => setControlFocusNeighbor(control, 0, value) },
    focus_neighbor_top: { configurable: true, enumerable: true, get: () => getControlFocusNeighbor(control, 1), set: (value: string | GodotNodePath) => setControlFocusNeighbor(control, 1, value) },
    focus_neighbor_right: { configurable: true, enumerable: true, get: () => getControlFocusNeighbor(control, 2), set: (value: string | GodotNodePath) => setControlFocusNeighbor(control, 2, value) },
    focus_neighbor_bottom: { configurable: true, enumerable: true, get: () => getControlFocusNeighbor(control, 3), set: (value: string | GodotNodePath) => setControlFocusNeighbor(control, 3, value) },
    focus_next: { configurable: true, enumerable: true, get: () => getControlFocusNext(control), set: (value: string | GodotNodePath) => setControlFocusNext(control, value) },
    focus_previous: { configurable: true, enumerable: true, get: () => getControlFocusPrevious(control), set: (value: string | GodotNodePath) => setControlFocusPrevious(control, value) },
    layout_direction: { configurable: true, enumerable: true, get: () => getControlLayoutDirection(control), set: (value: number) => setControlLayoutDirection(control, value) },
    grow_horizontal: { configurable: true, enumerable: true, get: () => getControlGrowHorizontal(control), set: (value: number) => setControlGrowHorizontal(control, value) },
    grow_vertical: { configurable: true, enumerable: true, get: () => getControlGrowVertical(control), set: (value: number) => setControlGrowVertical(control, value) },
    clip_contents: { configurable: true, enumerable: true, get: () => getControlClipContents(control), set: (value: boolean) => setControlClipContents(control, value) },
    tooltip_text: { configurable: true, enumerable: true, get: () => getControlTooltipText(control), set: (value: string) => setControlTooltipText(control, value) },
    hint_tooltip: { configurable: true, enumerable: true, get: () => getControlTooltipText(control), set: (value: string) => setControlTooltipText(control, value) },
    mouse_entered: { configurable: true, enumerable: true, get: () => getControlMouseEnteredSignal(control) },
    minimum_size_changed: { configurable: true, enumerable: true, get: () => getControlMinimumSizeChangedSignal(control) },
  });
  Object.assign(control, {
    set_focus_mode: (value: number): void => setControlFocusMode(control, value),
    get_focus_mode: (): number => getControlFocusMode(control),
    get_focus_mode_with_override: (): number => getControlFocusMode(control),
    find_next_valid_focus: (): Container | null => adjacentFocus(1),
    find_prev_valid_focus: (): Container | null => adjacentFocus(-1),
    grab_focus: (): void => grabControlFocus(
      control as T & GodotCanvasControlInteractionApi & { focus?: () => void; blur?: () => void },
    ),
    grab_click_focus: (): void => grabControlClickFocus(control),
    release_focus: (): void => releaseControlFocus(control),
    has_focus: (): boolean => hasControlFocus(control),
    get_focus_owner: (): object | null => getControlFocusOwner(control),
    set_focus_neighbor: (side: number, path: string | GodotNodePath): void => setControlFocusNeighbor(control, side, path),
    get_focus_neighbor: (side: number): GodotNodePath => getControlFocusNeighbor(control, side),
    set_focus_next: (path: string | GodotNodePath): void => setControlFocusNext(control, path),
    get_focus_next: (): GodotNodePath => getControlFocusNext(control),
    set_focus_previous: (path: string | GodotNodePath): void => setControlFocusPrevious(control, path),
    get_focus_previous: (): GodotNodePath => getControlFocusPrevious(control),
    set_layout_direction: (value: number): void => setControlLayoutDirection(control, value),
    get_layout_direction: (): number => getControlLayoutDirection(control),
    is_layout_rtl: (): boolean => isControlLayoutRtl(control),
    set_h_grow_direction: (value: number): void => setControlGrowHorizontal(control, value),
    get_h_grow_direction: (): number => getControlGrowHorizontal(control),
    set_v_grow_direction: (value: number): void => setControlGrowVertical(control, value),
    get_v_grow_direction: (): number => getControlGrowVertical(control),
    set_clip_contents: (value: boolean): void => setControlClipContents(control, value),
    is_clipping_contents: (): boolean => getControlClipContents(control),
    set_block_minimum_size_adjustment: (value: boolean): void => setControlBlockMinimumSizeAdjustment(control, value),
    is_block_minimum_size_adjustment_enabled: (): boolean => isControlMinimumSizeAdjustmentBlocked(control),
    set_tooltip_text: (value: string): void => setControlTooltipText(control, value),
    get_tooltip_text: (): string => getControlTooltipText(control),
    set_tooltip: (value: string): void => setControlTooltipText(control, value),
    get_tooltip: (): string => getControlTooltipText(control),
  });
  return control;
}
