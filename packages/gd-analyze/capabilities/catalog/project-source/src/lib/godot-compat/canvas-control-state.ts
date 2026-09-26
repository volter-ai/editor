import type { Container, FederatedPointerEvent, PointData } from 'pixi.js';

import {
  createControlState,
  optionalControlBinding,
  registerControlBinding,
  releaseControlBinding,
  type ControlGuiPointerEvent,
  type GodotControl,
  type ControlPoint,
} from './control-state';
import { releaseControlSignals } from './control-signals';
import { bindControlLayoutDirectionChanged, isControlLayoutRtl } from './control-layout';
import { createGodotRenderedFont, type GodotFont } from './font';
import { godotRect2New, type GodotRect2 } from './rect2';
import type { GodotCanvasItem } from './node';
import { controlThemeFont, getControlThemeConstant, hasControlThemeConstant, setControlThemeParent } from './theme';
import type { GodotTransform2D } from './transform-2d';

type CanvasContainerLayout = 'horizontal' | 'vertical' | 'grid' | 'scroll' |
  'flow-horizontal' | 'flow-vertical' | 'split-horizontal' | 'split-vertical' |
  'aspect' | 'margin' | 'panel' | 'center' | 'fill';

export interface CanvasControlInitialState {
  readonly position: ControlPoint;
  readonly size: ControlPoint;
  readonly anchor: ControlPoint;
  readonly anchorLeft?: number;
  readonly anchorTop?: number;
  readonly anchorRight?: number;
  readonly anchorBottom?: number;
  readonly customMinimumSize: ControlPoint;
  readonly customMaximumSize?: ControlPoint;
  readonly sizeFlagsHorizontal: number;
  readonly sizeFlagsVertical: number;
  readonly mouseFilter: number;
  readonly margins?: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly fallbackFontFamily?: string;
  readonly fallbackFontSize?: number;
  readonly defaultThemeType?: string;
  /** TextureRect/Sprite-backed Controls own a native width/height. Text and container nodes do not. */
  readonly nativeSize: boolean;
  readonly containerLayout?: CanvasContainerLayout;
  readonly separation?: number;
  readonly rowSeparation?: number;
  readonly columns?: number;
  readonly alignment?: 0 | 1 | 2;
  readonly scroll?: ControlPoint;
  readonly lastWrapAlignment?: 0 | 1 | 2 | 3;
  readonly reverseFill?: boolean;
  readonly splitOffset?: number;
  readonly splitCollapsed?: boolean;
  readonly aspectRatio?: number;
  readonly stretchMode?: number;
  readonly verticalAlignment?: 0 | 1 | 2;
  readonly centerUseTopLeft?: boolean;
  readonly contentInsets?: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly stretchRatio?: number;
  readonly minimumFloor?: ControlPoint;
  readonly useLocalBoundsMinimum?: boolean;
  readonly applySize?: (size: ControlPoint) => void;
  /** Authored nearest Control ancestor, available before Pixi attaches the display tree. */
  readonly themeParent?: () => object | null;
}

/** Native-shaped Control members installed on the same retained Pixi Container. */
export type GodotCanvasControl = GodotCanvasItem & {
  /** Godot 3 property spellings retained beside Godot 4's position/size accessors. */
  rect_position: ControlPoint;
  rect_size: ControlPoint;
  anchor_left: number;
  anchor_top: number;
  anchor_right: number;
  anchor_bottom: number;
  offset_left: number;
  offset_top: number;
  offset_right: number;
  offset_bottom: number;
  margin_left: number;
  margin_top: number;
  margin_right: number;
  margin_bottom: number;
  anchors_preset: number;
  custom_minimum_size: ControlPoint;
  size_flags_horizontal: number;
  size_flags_vertical: number;
  size_flags_stretch_ratio: number;
  mouse_filter: number;
  global_position: ControlPoint;
  set_position(value: ControlPoint, keepOffsets?: boolean): void;
  get_position(): ControlPoint;
  set_global_position(value: ControlPoint, keepOffsets?: boolean): void;
  get_global_position(): ControlPoint;
  get_global_transform(): GodotTransform2D;
  get_global_transform_with_canvas(): GodotTransform2D;
  set_visible(value: boolean): void;
  is_visible(): boolean;
  is_visible_in_tree(): boolean;
  show(): void;
  hide(): void;
  set_size(value: ControlPoint, keepOffsets?: boolean): void;
  get_size(): ControlPoint;
  set_custom_minimum_size(value: ControlPoint): void;
  get_custom_minimum_size(): ControlPoint;
  get_minimum_size(): ControlPoint;
  get_combined_minimum_size(): ControlPoint;
  reset_size(): void;
  set_anchor(side: number, anchor: number, keepOffset?: boolean, pushOppositeAnchor?: boolean): void;
  get_anchor(side: number): number;
  set_offset(side: number, offset: number): void;
  get_offset(side: number): number;
  set_anchor_and_offset(side: number, anchor: number, offset: number, pushOppositeAnchor?: boolean): void;
  set_anchors_preset(preset: number, keepOffsets?: boolean): void;
  set_anchors_and_offsets_preset(preset: number, resizeMode?: number, margin?: number): void;
  get_anchors_preset(): number;
  set_h_size_flags(value: number): void;
  get_h_size_flags(): number;
  set_v_size_flags(value: number): void;
  get_v_size_flags(): number;
  set_stretch_ratio(value: number): void;
  get_stretch_ratio(): number;
  set_mouse_filter(value: number): void;
  get_mouse_filter(): number;
  get_rect(): GodotRect2;
  get_global_rect(): GodotRect2;
  get_parent_area_size(): ControlPoint;
  get_parent_control(): Container | null;
  get_screen_position(): ControlPoint;
  set_begin(value: ControlPoint): void;
  get_begin(): ControlPoint;
  set_end(value: ControlPoint): void;
  get_end(): ControlPoint;
  get_mouse_filter_with_override(): number;
  fit_child_in_rect(child: Container, rect: GodotRect2): void;
};

interface CanvasControlState {
  position: ControlPoint;
  size: ControlPoint;
  readonly anchor: ControlPoint;
  anchorLeft: number;
  anchorTop: number;
  anchorRight: number;
  anchorBottom: number;
  customMinimumSize: ControlPoint;
  customMaximumSize: ControlPoint;
  sizeFlagsHorizontal: number;
  sizeFlagsVertical: number;
  mouseFilter: number;
  margins: { left: number; top: number; right: number; bottom: number };
  readonly fallbackFontFamily: string;
  readonly fallbackFontSize: number;
  readonly defaultThemeType: string;
  fallbackFont?: GodotFont;
  readonly nativeSize: boolean;
  containerLayout?: CanvasContainerLayout;
  separation: number;
  rowSeparation: number;
  columns: number;
  alignment: 0 | 1 | 2;
  scroll: ControlPoint;
  lastWrapAlignment: 0 | 1 | 2 | 3;
  reverseFill: boolean;
  splitOffset: number;
  splitCollapsed: boolean;
  splitDivider: number;
  aspectRatio: number;
  stretchMode: number;
  verticalAlignment: 0 | 1 | 2;
  centerUseTopLeft: boolean;
  contentInsets: { left: number; top: number; right: number; bottom: number };
  stretchRatio: number;
  readonly minimumFloor: ControlPoint;
  readonly useLocalBoundsMinimum: boolean;
  readonly applySize?: (size: ControlPoint) => void;
  appliedSize?: ControlPoint;
  onContainerLayout?: () => void;
  onContainerPreSort?: () => void;
  onContainerSorted?: () => void;
  readonly stopPropagation: (event: { stopPropagation(): void }) => void;
  readonly emitMouseEntered: () => void;
  readonly routePointer: (event: FederatedPointerEvent) => void;
  releaseLayoutDirection?: () => void;
}

const canvasControls = new WeakMap<Container, CanvasControlState>();
const GUI_POINTER_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointerupoutside',
  'pointermove',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
  'pointercancel',
  'pointertap',
  'click',
  'rightclick',
  'wheel',
] as const;

function copy(value: unknown): ControlPoint {
  if (
    typeof value !== 'object' || value === null ||
    !('x' in value) || !('y' in value) ||
    typeof value.x !== 'number' || typeof value.y !== 'number' ||
    !Number.isFinite(value.x) || !Number.isFinite(value.y)
  ) {
    throw new TypeError('Godot Control Vector2 must be finite.');
  }
  return { x: value.x, y: value.y };
}

function flags(value: number): number {
  if (!Number.isInteger(value) || value < 0 || (value & ~0xf) !== 0) {
    throw new Error(`Godot Control size flags contain an unknown bit: ${String(value)}.`);
  }
  return value;
}

function filter(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error(`Godot Control mouse_filter must be STOP (0), PASS (1), or IGNORE (2); received ${String(value)}.`);
  }
  return value;
}

function stateOf(node: Container): CanvasControlState {
  const state = canvasControls.get(node);
  if (state === undefined) throw new Error('Native Pixi Control is not bound to Godot Control state.');
  return state;
}

function finiteAnchor(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite number.`);
  return value;
}

function controlParentRect(
  node: Container,
  member: string,
): Readonly<{ position: ControlPoint; size: ControlPoint }> {
  const parent = node.parent;
  if (parent === null) {
    throw new Error(`${member} requires an attached Control parent so its anchor has a native reference rect.`);
  }
  const parentState = canvasControls.get(parent);
  if (parentState !== undefined) return { position: { x: 0, y: 0 }, size: copy(parentState.size) };
  const bounds = parent.getLocalBounds();
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    throw new Error(`${member} cannot resolve the parent reference rect.`);
  }
  return {
    position: { x: bounds.x, y: bounds.y },
    size: { x: bounds.width, y: bounds.height },
  };
}

function applyAnchoredOffsets(node: Container, state: CanvasControlState, member: string): void {
  const parent = controlParentRect(node, member);
  const left = parent.position.x + state.anchorLeft * parent.size.x + state.margins.left;
  const top = parent.position.y + state.anchorTop * parent.size.y + state.margins.top;
  const right = parent.position.x + state.anchorRight * parent.size.x + state.margins.right;
  const bottom = parent.position.y + state.anchorBottom * parent.size.y + state.margins.bottom;
  const minimum = minimumOf(node, state);
  state.position = { x: left, y: top };
  state.size = { x: Math.max(right - left, minimum.x), y: Math.max(bottom - top, minimum.y) };
  applyRect(node, state);
  reflowCanvasContainer(node);
  reflowParent(node);
}

function applyPosition(node: Container, state: CanvasControlState): void {
  // The translator seeds `position` with the logical ControlBox top-left. Pixi Text is authored at
  // that top-left plus its glyph anchor times the ControlBox size; recomputing that projection here
  // keeps `global_position` logical while the retained native point remains anchor-correct.
  node.position.set(
    state.position.x + state.anchor.x * state.size.x,
    state.position.y + state.anchor.y * state.size.y,
  );
}

function applyRect(node: Container, state: CanvasControlState): void {
  const minimum = minimumOf(node, state);
  state.size = {
    x: state.customMaximumSize.x > 0
      ? Math.min(state.size.x, Math.max(minimum.x, state.customMaximumSize.x))
      : state.size.x,
    y: state.customMaximumSize.y > 0
      ? Math.min(state.size.y, Math.max(minimum.y, state.customMaximumSize.y))
      : state.size.y,
  };
  const changed = state.appliedSize === undefined ||
    state.appliedSize.x !== state.size.x || state.appliedSize.y !== state.size.y;
  const binding = optionalControlBinding(node);
  const retainedSize = binding === undefined
    ? undefined
    : binding.state.read(binding.id).size ?? binding.state.authored(binding.id)?.size;
  const nativeLayoutChanged = changed && retainedSize !== undefined &&
    (retainedSize.x !== state.size.x || retainedSize.y !== state.size.y);
  applyPosition(node, state);
  if (state.nativeSize) {
    node.width = state.size.x;
    node.height = state.size.y;
  }
  state.applySize?.(copy(state.size));
  state.appliedSize = copy(state.size);
  if (nativeLayoutChanged) binding?.state.read(binding.id).onControlResized?.();
}

function minimumOf(node: Container, state: CanvasControlState): ControlPoint {
  const bounds = state.useLocalBoundsMinimum ? node.getLocalBounds() : { width: 0, height: 0 };
  const content = containerContentMinimum(node, state);
  return {
    x: Math.max(state.customMinimumSize.x, state.minimumFloor.x, bounds.width, content.x),
    y: Math.max(state.customMinimumSize.y, state.minimumFloor.y, bounds.height, content.y),
  };
}

function containerContentMinimum(node: Container, state: CanvasControlState): ControlPoint {
  const layout = state.containerLayout;
  if (layout === undefined) return { x: 0, y: 0 };
  const children = node.children.flatMap((child) => {
    const childState = canvasControls.get(child);
    return childState === undefined || !child.visible
      ? []
      : [{ state: childState, minimum: minimumOf(child, childState) }];
  });
  if (children.length === 0) return { x: 0, y: 0 };
  if (layout === 'margin') {
    const horizontal = getControlThemeConstant(node, 'margin_left', 'MarginContainer') +
      getControlThemeConstant(node, 'margin_right', 'MarginContainer');
    const vertical = getControlThemeConstant(node, 'margin_top', 'MarginContainer') +
      getControlThemeConstant(node, 'margin_bottom', 'MarginContainer');
    return {
      x: Math.max(...children.map((child) => child.minimum.x)) + horizontal,
      y: Math.max(...children.map((child) => child.minimum.y)) + vertical,
    };
  }
  if (layout === 'panel') {
    return {
      x: Math.max(...children.map((child) => child.minimum.x)) + state.contentInsets.left + state.contentInsets.right,
      y: Math.max(...children.map((child) => child.minimum.y)) + state.contentInsets.top + state.contentInsets.bottom,
    };
  }
  if (layout === 'horizontal' || layout === 'split-horizontal' || layout === 'flow-horizontal') {
    const gap = layoutSeparation(node, state, 'horizontal');
    return {
      x: children.reduce((sum, child) => sum + child.minimum.x, 0) +
        Math.max(0, children.length - 1) * gap,
      y: Math.max(...children.map((child) => child.minimum.y)),
    };
  }
  if (layout === 'vertical' || layout === 'split-vertical' || layout === 'flow-vertical') {
    const gap = layoutSeparation(node, state, 'vertical');
    return {
      x: Math.max(...children.map((child) => child.minimum.x)),
      y: children.reduce((sum, child) => sum + child.minimum.y, 0) +
        Math.max(0, children.length - 1) * gap,
    };
  }
  if (layout === 'grid') {
    const columns = Math.max(1, state.columns);
    const rows = Math.ceil(children.length / columns);
    const columnMinimums = Array.from({ length: columns }, () => 0);
    const rowMinimums = Array.from({ length: rows }, () => 0);
    children.forEach((child, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      columnMinimums[column] = Math.max(columnMinimums[column] ?? 0, child.minimum.x);
      rowMinimums[row] = Math.max(rowMinimums[row] ?? 0, child.minimum.y);
    });
    return {
      x: columnMinimums.reduce((sum, value) => sum + value, 0) +
        Math.max(0, columns - 1) * layoutSeparation(node, state, 'horizontal'),
      y: rowMinimums.reduce((sum, value) => sum + value, 0) +
        Math.max(0, rows - 1) * layoutSeparation(node, state, 'vertical'),
    };
  }
  const maximum = {
    x: Math.max(...children.map((child) => child.minimum.x)),
    y: Math.max(...children.map((child) => child.minimum.y)),
  };
  if (layout !== 'aspect') return maximum;
  if (maximum.x / Math.max(maximum.y, Number.EPSILON) > state.aspectRatio) {
    return { x: maximum.x, y: maximum.x / state.aspectRatio };
  }
  return { x: maximum.y * state.aspectRatio, y: maximum.y };
}

function intrinsicMinimumOf(node: Container, state: CanvasControlState): ControlPoint {
  const bounds = state.useLocalBoundsMinimum ? node.getLocalBounds() : { width: 0, height: 0 };
  return {
    x: Math.max(state.minimumFloor.x, bounds.width),
    y: Math.max(state.minimumFloor.y, bounds.height),
  };
}

function layoutSeparation(
  node: Container,
  state: CanvasControlState,
  axis: 'horizontal' | 'vertical',
): number {
  const directional = state.containerLayout === 'grid' ||
    state.containerLayout === 'flow-horizontal' || state.containerLayout === 'flow-vertical';
  const name = directional
    ? axis === 'horizontal' ? 'h_separation' : 'v_separation'
    : 'separation';
  const fallback = axis === 'horizontal' ? state.separation :
    directional ? state.rowSeparation : state.separation;
  return hasControlThemeConstant(node, name) ? getControlThemeConstant(node, name) : fallback;
}

function fitAxis(minimum: number, available: number, flagsValue: number): readonly [number, number] {
  if ((flagsValue & 1) !== 0) return [0, available];
  const size = Math.min(minimum, available);
  if ((flagsValue & 8) !== 0) return [available - size, size];
  if ((flagsValue & 4) !== 0) return [(available - size) / 2, size];
  return [0, size];
}

/** Port of BoxContainer's minimum/stretch/final-fit passes over the retained Pixi children. */
export function reflowCanvasContainer(parent: Container): void {
  const state = canvasControls.get(parent);
  if (state === undefined) return;
  state.onContainerPreSort?.();
  try {
    performCanvasContainerReflow(parent);
  } finally {
    state.onContainerSorted?.();
  }
}

function performCanvasContainerReflow(parent: Container): void {
  const parentState = canvasControls.get(parent);
  if (parentState?.containerLayout === undefined) return;
  const vertical = parentState.containerLayout === 'vertical';
  const children = parent.children.flatMap((child) => {
    const state = canvasControls.get(child);
    return state === undefined || !child.visible ? [] : [{ node: child, state, minimum: minimumOf(child, state) }];
  });
  if (children.length === 0) return;
  const horizontalSeparation = layoutSeparation(parent, parentState, 'horizontal');
  const verticalSeparation = layoutSeparation(parent, parentState, 'vertical');
  if (parentState.containerLayout === 'fill') {
    for (const child of children) {
      child.state.position = { x: 0, y: 0 };
      child.state.size = {
        x: Math.max(parentState.size.x, child.minimum.x),
        y: Math.max(parentState.size.y, child.minimum.y),
      };
      applyRect(child.node, child.state);
    }
    parentState.onContainerLayout?.();
    return;
  }
  if (parentState.containerLayout === 'center') {
    for (const child of children) {
      const width = Math.max(child.minimum.x, child.state.size.x);
      const height = Math.max(child.minimum.y, child.state.size.y);
      child.state.position = {
        x: parentState.centerUseTopLeft ? Math.max(0, (parentState.size.x - width) / 2) : (parentState.size.x - width) / 2,
        y: parentState.centerUseTopLeft ? Math.max(0, (parentState.size.y - height) / 2) : (parentState.size.y - height) / 2,
      };
      child.state.size = { x: width, y: height };
      applyRect(child.node, child.state);
    }
    parentState.onContainerLayout?.();
    return;
  }
  if (parentState.containerLayout === 'margin') {
    const left = getControlThemeConstant(parent, 'margin_left', 'MarginContainer');
    const top = getControlThemeConstant(parent, 'margin_top', 'MarginContainer');
    const right = getControlThemeConstant(parent, 'margin_right', 'MarginContainer');
    const bottom = getControlThemeConstant(parent, 'margin_bottom', 'MarginContainer');
    const available = {
      x: Math.max(0, parentState.size.x - left - right),
      y: Math.max(0, parentState.size.y - top - bottom),
    };
    for (const child of children) {
      const [x, width] = fitAxis(child.minimum.x, available.x, child.state.sizeFlagsHorizontal);
      const [y, height] = fitAxis(child.minimum.y, available.y, child.state.sizeFlagsVertical);
      child.state.position = { x: left + x, y: top + y };
      child.state.size = { x: width, y: height };
      applyRect(child.node, child.state);
    }
    parentState.onContainerLayout?.();
    return;
  }
  if (parentState.containerLayout === 'panel') {
    const { left, top, right, bottom } = parentState.contentInsets;
    const available = {
      x: Math.max(0, parentState.size.x - left - right),
      y: Math.max(0, parentState.size.y - top - bottom),
    };
    for (const child of children) {
      const [x, width] = fitAxis(child.minimum.x, available.x, child.state.sizeFlagsHorizontal);
      const [y, height] = fitAxis(child.minimum.y, available.y, child.state.sizeFlagsVertical);
      child.state.position = { x: left + x, y: top + y };
      child.state.size = { x: width, y: height };
      applyRect(child.node, child.state);
    }
    parentState.onContainerLayout?.();
    return;
  }
  if (parentState.containerLayout === 'scroll') {
    for (const child of children) {
      child.state.position = { x: -parentState.scroll.x, y: -parentState.scroll.y };
      child.state.size = {
        x: Math.max(child.minimum.x, child.state.size.x),
        y: Math.max(child.minimum.y, child.state.size.y),
      };
      applyRect(child.node, child.state);
    }
    return;
  }
  if (parentState.containerLayout === 'flow-horizontal' || parentState.containerLayout === 'flow-vertical') {
    const vertical = parentState.containerLayout === 'flow-vertical';
    const mainLimit = vertical ? parentState.size.y : parentState.size.x;
    const mainGap = vertical ? verticalSeparation : horizontalSeparation;
    const crossGap = vertical ? horizontalSeparation : verticalSeparation;
    const lines: typeof children[] = [];
    let line: typeof children = [];
    let used = 0;
    for (const child of children) {
      const main = vertical ? child.minimum.y : child.minimum.x;
      const next = line.length === 0 ? main : used + mainGap + main;
      if (line.length > 0 && next > mainLimit) {
        lines.push(line);
        line = [];
        used = 0;
      }
      line.push(child);
      used = line.length === 1 ? main : used + mainGap + main;
    }
    if (line.length > 0) lines.push(line);
    const crossSizes = lines.map((oneLine) =>
      oneLine.reduce((maximum, child) => Math.max(maximum, vertical ? child.minimum.x : child.minimum.y), 0),
    );
    const lineOrder = lines.map((_, index) => index);
    if (parentState.reverseFill) lineOrder.reverse();
    const availableCross = vertical ? parentState.size.x : parentState.size.y;
    const totalCross = crossSizes.reduce((sum, value) => sum + value, 0) + crossGap * Math.max(0, lines.length - 1);
    let crossCursor = parentState.reverseFill ? availableCross - totalCross : 0;
    lineOrder.forEach((logicalLineIndex) => {
      const oneLine = lines[logicalLineIndex]!;
      const crossSize = crossSizes[logicalLineIndex]!;
      const minimumMain = oneLine.map((child) => vertical ? child.minimum.y : child.minimum.x);
      const minimumOccupied = minimumMain.reduce((sum, value) => sum + value, 0) + mainGap * Math.max(0, oneLine.length - 1);
      const expanders = oneLine.flatMap((child, index) => {
        const flags = vertical ? child.state.sizeFlagsVertical : child.state.sizeFlagsHorizontal;
        return (flags & 2) === 0 ? [] : [{ index, ratio: Math.max(0, child.state.stretchRatio) }];
      });
      const ratioTotal = expanders.reduce((sum, child) => sum + child.ratio, 0);
      const expandable = Math.max(0, mainLimit - minimumOccupied);
      const mainSizes = [...minimumMain];
      if (expanders.length > 0 && expandable > 0) {
        const denominator = ratioTotal > 0 ? ratioTotal : expanders.length;
        for (const expander of expanders) {
          mainSizes[expander.index] = (mainSizes[expander.index] ?? 0) +
            expandable * (ratioTotal > 0 ? expander.ratio : 1) / denominator;
        }
      }
      const occupied = mainSizes.reduce((sum, value) => sum + value, 0) + mainGap * Math.max(0, oneLine.length - 1);
      const alignment = logicalLineIndex === lines.length - 1 && parentState.lastWrapAlignment !== 3
        ? parentState.lastWrapAlignment
        : parentState.alignment;
      let mainCursor = alignment === 1 ? (mainLimit - occupied) / 2 : alignment === 2 ? mainLimit - occupied : 0;
      oneLine.forEach((child, childIndex) => {
        const main = mainSizes[childIndex] ?? 0;
        const crossFlags = vertical ? child.state.sizeFlagsHorizontal : child.state.sizeFlagsVertical;
        const crossMinimum = vertical ? child.minimum.x : child.minimum.y;
        const [crossOffset, fittedCross] = fitAxis(crossMinimum, crossSize, crossFlags);
        child.state.position = vertical
          ? { x: crossCursor + crossOffset, y: mainCursor }
          : { x: mainCursor, y: crossCursor + crossOffset };
        child.state.size = vertical
          ? { x: fittedCross, y: main }
          : { x: main, y: fittedCross };
        applyRect(child.node, child.state);
        mainCursor += main + mainGap;
      });
      crossCursor += crossSize + crossGap;
    });
    return;
  }
  if (parentState.containerLayout === 'split-horizontal' || parentState.containerLayout === 'split-vertical') {
    if (children.length > 2) throw new Error('SplitContainer supports exactly two retained Control children.');
    if (children.length === 0) return;
    const vertical = parentState.containerLayout === 'split-vertical';
    const mainSize = vertical ? parentState.size.y : parentState.size.x;
    const crossSize = vertical ? parentState.size.x : parentState.size.y;
    const separation = children.length === 2 && !parentState.splitCollapsed ? horizontalSeparation : 0;
    const firstMinimum = vertical ? children[0]!.minimum.y : children[0]!.minimum.x;
    const secondMinimum = children[1] === undefined ? 0 : vertical ? children[1].minimum.y : children[1].minimum.x;
    const firstSize = parentState.splitCollapsed
      ? 0
      : Math.min(Math.max((mainSize - separation) / 2 + parentState.splitOffset, firstMinimum), Math.max(firstMinimum, mainSize - separation - secondMinimum));
    parentState.splitDivider = firstSize + separation / 2;
    children.forEach((child, index) => {
      const mainStart = index === 0 ? 0 : firstSize + separation;
      const main = index === 0 ? firstSize : Math.max(0, mainSize - mainStart);
      child.node.renderable = !(parentState.splitCollapsed && index === 0);
      child.state.position = vertical ? { x: 0, y: mainStart } : { x: mainStart, y: 0 };
      child.state.size = vertical ? { x: crossSize, y: main } : { x: main, y: crossSize };
      applyRect(child.node, child.state);
    });
    parentState.onContainerLayout?.();
    return;
  }
  if (parentState.containerLayout === 'aspect') {
    if (children.length === 0) return;
    const available = parentState.size;
    let width: number;
    let height: number;
    if (parentState.stretchMode === 0) {
      width = available.x;
      height = width / parentState.aspectRatio;
    } else if (parentState.stretchMode === 1) {
      height = available.y;
      width = height * parentState.aspectRatio;
    } else {
      const ratio = parentState.stretchMode === 3
        ? Math.max(available.x / parentState.aspectRatio, available.y)
        : Math.min(available.x / parentState.aspectRatio, available.y);
      height = ratio;
      width = ratio * parentState.aspectRatio;
    }
    for (const child of children) {
      const childWidth = Math.max(width, child.minimum.x);
      const childHeight = Math.max(height, child.minimum.y);
      const x = parentState.alignment === 1 ? (available.x - childWidth) / 2 : parentState.alignment === 2 ? available.x - childWidth : 0;
      const y = parentState.verticalAlignment === 1 ? (available.y - childHeight) / 2 : parentState.verticalAlignment === 2 ? available.y - childHeight : 0;
      child.state.position = { x, y };
      child.state.size = { x: childWidth, y: childHeight };
      applyRect(child.node, child.state);
    }
    return;
  }
  if (parentState.containerLayout === 'grid') {
    const columns = Math.max(1, parentState.columns);
    const rows = Math.ceil(children.length / columns);
    const columnMinimum = Array.from({ length: columns }, () => 0);
    const rowMinimum = Array.from({ length: rows }, () => 0);
    const expandedColumns = new Set<number>();
    const expandedRows = new Set<number>();
    children.forEach((child, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      columnMinimum[column] = Math.max(columnMinimum[column] ?? 0, child.minimum.x);
      rowMinimum[row] = Math.max(rowMinimum[row] ?? 0, child.minimum.y);
      if ((child.state.sizeFlagsHorizontal & 2) !== 0) expandedColumns.add(column);
      if ((child.state.sizeFlagsVertical & 2) !== 0) expandedRows.add(row);
    });
    const distributable = (available: number, minimums: readonly number[], expanded: ReadonlySet<number>, gap: number): number[] => {
      const sizes = [...minimums];
      let extra = Math.max(0, available - minimums.reduce((sum, value) => sum + value, 0) - Math.max(0, minimums.length - 1) * gap);
      const active = new Set(expanded);
      while (extra > 0 && active.size > 0) {
        const each = Math.floor(extra / active.size);
        if (each === 0) {
          for (const index of active) {
            if (extra === 0) break;
            sizes[index] = (sizes[index] ?? 0) + 1;
            extra -= 1;
          }
          break;
        }
        for (const index of active) sizes[index] = (sizes[index] ?? 0) + each;
        extra -= each * active.size;
      }
      return sizes;
    };
    const columnWidths = distributable(parentState.size.x, columnMinimum, expandedColumns, horizontalSeparation);
    const rowHeights = distributable(parentState.size.y, rowMinimum, expandedRows, verticalSeparation);
    const columnOffsets: number[] = [];
    const rowOffsets: number[] = [];
    columnWidths.reduce((offset, width, index) => { columnOffsets[index] = offset; return offset + width + horizontalSeparation; }, 0);
    rowHeights.reduce((offset, height, index) => { rowOffsets[index] = offset; return offset + height + verticalSeparation; }, 0);
    children.forEach((child, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const available = { x: columnWidths[column] ?? 0, y: rowHeights[row] ?? 0 };
      const [x, width] = fitAxis(child.minimum.x, available.x, child.state.sizeFlagsHorizontal);
      const [y, height] = fitAxis(child.minimum.y, available.y, child.state.sizeFlagsVertical);
      child.state.position = { x: (columnOffsets[column] ?? 0) + x, y: (rowOffsets[row] ?? 0) + y };
      child.state.size = { x: width, y: height };
      applyRect(child.node, child.state);
    });
    return;
  }
  const axisSize = vertical ? parentState.size.y : parentState.size.x;
  const separation = vertical ? verticalSeparation : horizontalSeparation;
  const minimumTotal = children.reduce(
    (sum, child) => sum + (vertical ? child.minimum.y : child.minimum.x),
    0,
  );
  const stretchDifference = Math.max(
    0,
    axisSize - separation * Math.max(0, children.length - 1) - minimumTotal,
  );
  const stretchers = children.filter((child) =>
    ((vertical ? child.state.sizeFlagsVertical : child.state.sizeFlagsHorizontal) & 2) !== 0,
  );
  const active = new Set(stretchers);
  const finalMain = new Map(children.map((child) => [
    child,
    vertical ? child.minimum.y : child.minimum.x,
  ]));
  let ratioTotal = stretchers.reduce((sum, child) => sum + child.state.stretchRatio, 0);
  let stretchAvailable =
    stretchers.reduce(
      (sum, child) => sum + (vertical ? child.minimum.y : child.minimum.x),
      0,
    ) + stretchDifference;
  let changed = true;
  while (changed && ratioTotal > 0) {
    changed = false;
    for (const child of active) {
      const minimumMain = vertical ? child.minimum.y : child.minimum.x;
      const authoredMaximum = vertical ? child.state.customMaximumSize.y : child.state.customMaximumSize.x;
      const maximumMain = authoredMaximum > 0 ? Math.max(minimumMain, authoredMaximum) : -1;
      const proposed = (stretchAvailable * child.state.stretchRatio) / ratioTotal;
      if (proposed >= minimumMain && (maximumMain < 0 || proposed <= maximumMain)) continue;
      active.delete(child);
      const fixed = proposed < minimumMain ? minimumMain : maximumMain;
      finalMain.set(child, fixed);
      stretchAvailable -= fixed;
      ratioTotal -= child.state.stretchRatio;
      changed = true;
      break;
    }
  }
  let error = 0;
  for (const child of children) {
    if (!active.has(child) || ratioTotal <= 0) continue;
    const exact = (stretchAvailable * child.state.stretchRatio) / ratioTotal;
    let allocated = Math.trunc(exact);
    error += exact - allocated;
    const authoredMaximum = vertical ? child.state.customMaximumSize.y : child.state.customMaximumSize.x;
    if (error >= 1 && (authoredMaximum <= 0 || allocated < authoredMaximum)) {
      allocated += 1;
      error -= 1;
    }
    finalMain.set(child, allocated);
  }
  const finalStretchDifference = Math.max(
    0,
    axisSize - separation * Math.max(0, children.length - 1) -
      [...finalMain.values()].reduce((sum, value) => sum + value, 0),
  );
  const rtl = !vertical && isControlLayoutRtl(parent);
  let cursor = parentState.alignment === 1
      ? Math.trunc(finalStretchDifference / 2)
      : parentState.alignment === 0
        ? rtl ? finalStretchDifference : 0
        : rtl ? 0 : finalStretchDifference;
  for (const child of rtl ? [...children].reverse() : children) {
    const allocatedMain = finalMain.get(child)!;
    const allocated = vertical
      ? { x: parentState.size.x, y: allocatedMain }
      : { x: allocatedMain, y: parentState.size.y };
    const [xOffset, width] = fitAxis(child.minimum.x, allocated.x, child.state.sizeFlagsHorizontal);
    const [yOffset, height] = fitAxis(child.minimum.y, allocated.y, child.state.sizeFlagsVertical);
    child.state.position = vertical
      ? { x: xOffset, y: cursor + yOffset }
      : { x: cursor + xOffset, y: yOffset };
    child.state.size = { x: width, y: height };
    applyRect(child.node, child.state);
    cursor += allocatedMain + separation;
  }
}

/** Attach Container's public sort-signal lifecycle to this same native layout owner. */
export function setCanvasContainerSortLifecycle(
  node: Container,
  preSort: () => void,
  sorted: () => void,
): void {
  const state = stateOf(node);
  state.onContainerPreSort = preSort;
  state.onContainerSorted = sorted;
}

function reflowParent(node: Container): void {
  if (node.parent !== null) reflowCanvasContainer(node.parent);
}

/** Bind the logical Godot rect to the already-retained Pixi entity; no mirror node is created. */
export function bindCanvasControl<T extends Container>(node: T, initial: CanvasControlInitialState): T {
  releaseCanvasControl(node);
  const retained = createControlState();
  registerControlBinding(node as unknown as GodotControl, { id: 'control', state: retained });
  let lastPointerMotionTimestamp: number | undefined;
  const state: CanvasControlState = {
    position: copy(initial.position),
    size: copy(initial.size),
    anchor: copy(initial.anchor),
    anchorLeft: finiteAnchor(initial.anchorLeft ?? 0, 'Control.anchor_left'),
    anchorTop: finiteAnchor(initial.anchorTop ?? 0, 'Control.anchor_top'),
    anchorRight: finiteAnchor(initial.anchorRight ?? 0, 'Control.anchor_right'),
    anchorBottom: finiteAnchor(initial.anchorBottom ?? 0, 'Control.anchor_bottom'),
    customMinimumSize: copy(initial.customMinimumSize),
    customMaximumSize: copy(initial.customMaximumSize ?? { x: 0, y: 0 }),
    sizeFlagsHorizontal: flags(initial.sizeFlagsHorizontal),
    sizeFlagsVertical: flags(initial.sizeFlagsVertical),
    mouseFilter: filter(initial.mouseFilter),
    margins: {
      left: initial.margins?.left ?? 0,
      top: initial.margins?.top ?? 0,
      right: initial.margins?.right ?? 0,
      bottom: initial.margins?.bottom ?? 0,
    },
    fallbackFontFamily: initial.fallbackFontFamily ?? 'sans-serif',
    fallbackFontSize: initial.fallbackFontSize ?? 16,
    defaultThemeType: initial.defaultThemeType ?? 'Control',
    nativeSize: initial.nativeSize,
    ...(initial.containerLayout === undefined ? {} : { containerLayout: initial.containerLayout }),
    separation: initial.separation ?? 4,
    rowSeparation: initial.rowSeparation ?? initial.separation ?? 4,
    columns: initial.columns ?? 1,
    alignment: initial.alignment ?? 0,
    scroll: copy(initial.scroll ?? { x: 0, y: 0 }),
    lastWrapAlignment: initial.lastWrapAlignment ?? 3,
    reverseFill: initial.reverseFill ?? false,
    splitOffset: initial.splitOffset ?? 0,
    splitCollapsed: initial.splitCollapsed ?? false,
    splitDivider: 0,
    aspectRatio: initial.aspectRatio ?? 1,
    stretchMode: initial.stretchMode ?? 2,
    verticalAlignment: initial.verticalAlignment ?? 1,
    centerUseTopLeft: initial.centerUseTopLeft ?? false,
    contentInsets: {
      left: initial.contentInsets?.left ?? 0,
      top: initial.contentInsets?.top ?? 0,
      right: initial.contentInsets?.right ?? 0,
      bottom: initial.contentInsets?.bottom ?? 0,
    },
    stretchRatio: initial.stretchRatio ?? 1,
    minimumFloor: copy(initial.minimumFloor ?? { x: 0, y: 0 }),
    useLocalBoundsMinimum: initial.useLocalBoundsMinimum ?? false,
    ...(initial.applySize === undefined ? {} : { applySize: initial.applySize }),
    stopPropagation: (event) => {
      if (state.mouseFilter === 0) event.stopPropagation();
    },
    emitMouseEntered: () => {
      const binding = optionalControlBinding(node);
      binding?.state.read(binding.id).onMouseEntered?.();
    },
    routePointer: (event) => {
      const binding = optionalControlBinding(node);
      const route = binding?.state.read(binding.id).routeControlPointer;
      if (route === undefined) return;
      const point = node.toLocal(event.global);
      const nativeEvent = event.nativeEvent;
      const nativeTarget = nativeEvent?.target;
      const ctrlPressed =
        (typeof MouseEvent !== 'undefined' && nativeEvent instanceof MouseEvent) ||
        (typeof TouchEvent !== 'undefined' && nativeEvent instanceof TouchEvent)
          ? nativeEvent.ctrlKey
          : false;
      const mouse = typeof MouseEvent !== 'undefined' && nativeEvent instanceof MouseEvent
        ? nativeEvent
        : undefined;
      const timestamp = nativeEvent !== undefined && 'timeStamp' in nativeEvent
        ? nativeEvent.timeStamp
        : undefined;
      const elapsedSeconds = event.type !== 'pointermove' || timestamp === undefined || lastPointerMotionTimestamp === undefined
        ? undefined
        : (timestamp - lastPointerMotionTimestamp) / 1000;
      if (event.type === 'pointermove' && timestamp !== undefined) lastPointerMotionTimestamp = timestamp;
      const value: ControlGuiPointerEvent = {
        kind: event.type === 'pointermove' ? 'motion' : 'button',
        local: { x: point.x, y: point.y },
        global: { x: event.global.x, y: event.global.y },
        button: event.button,
        buttons: event.buttons,
        pressed: event.type === 'pointerdown',
        ctrlPressed,
        altPressed: mouse?.altKey ?? false,
        shiftPressed: mouse?.shiftKey ?? false,
        metaPressed: mouse?.metaKey ?? false,
        movement: { x: mouse?.movementX ?? 0, y: mouse?.movementY ?? 0 },
        ...(elapsedSeconds === undefined ? {} : { elapsedSeconds }),
        pointerId: event.pointerId,
        transferCapture: () => {
          if (!(nativeTarget instanceof Element) || !('setPointerCapture' in nativeTarget)) {
            throw new Error('Control.grab_click_focus requires the Pixi canvas pointer target to support capture.');
          }
          (nativeTarget as Element & { setPointerCapture(pointerId: number): void }).setPointerCapture(event.pointerId);
        },
      };
      if (!route(value)) event.stopImmediatePropagation();
    },
  };
  canvasControls.set(node, state);
  state.releaseLayoutDirection = bindControlLayoutDirectionChanged(node, () => {
    reflowCanvasContainer(node);
    reflowParent(node);
  });
  setControlThemeParent(node, initial.themeParent);
  applyRect(node, state);
  // Pixi `passive` ignores this Container while still traversing interactive children, matching
  // MOUSE_FILTER_IGNORE. `none` would incorrectly suppress the whole Control subtree.
  node.eventMode = state.mouseFilter === 2 ? 'passive' : 'static';
  for (const event of GUI_POINTER_EVENTS) node.on(event, state.stopPropagation);
  node.on('pointerdown', state.routePointer);
  node.on('pointerup', state.routePointer);
  node.on('pointerupoutside', state.routePointer);
  node.on('pointermove', state.routePointer);
  node.on('pointercancel', state.routePointer);
  node.on('pointerenter', state.emitMouseEntered);
  bindGodotCanvasControlApi(node);
  return node;
}

function controlSide(side: number, member: string): CanvasMargin {
  if (!Number.isSafeInteger(side) || side < 0 || side > 3) {
    throw new RangeError(`${member} side must be LEFT (0) through BOTTOM (3).`);
  }
  return (['left', 'top', 'right', 'bottom'] as const)[side]!;
}

/** Install the direct GDScript-facing Control vocabulary on a retained canvas entity. */
export function bindGodotCanvasControlApi<T extends Container>(source: T): T & GodotCanvasControl {
  const node = source as T & GodotCanvasControl;
  Object.defineProperties(node, {
    anchor_left: { configurable: true, enumerable: true, get: () => getCanvasControlAnchorLeft(node), set: (value: number) => setCanvasControlAnchorLeft(node, value) },
    anchor_top: { configurable: true, enumerable: true, get: () => getCanvasControlAnchorTop(node), set: (value: number) => setCanvasControlAnchorTop(node, value) },
    anchor_right: { configurable: true, enumerable: true, get: () => getCanvasControlAnchorRight(node), set: (value: number) => setCanvasControlAnchorRight(node, value) },
    anchor_bottom: { configurable: true, enumerable: true, get: () => getCanvasControlAnchorBottom(node), set: (value: number) => setCanvasControlAnchorBottom(node, value) },
    offset_left: { configurable: true, enumerable: true, get: () => getCanvasControlMargin(node, 'left'), set: (value: number) => setCanvasControlMargin(node, 'left', value) },
    offset_top: { configurable: true, enumerable: true, get: () => getCanvasControlMargin(node, 'top'), set: (value: number) => setCanvasControlMargin(node, 'top', value) },
    offset_right: { configurable: true, enumerable: true, get: () => getCanvasControlMargin(node, 'right'), set: (value: number) => setCanvasControlMargin(node, 'right', value) },
    offset_bottom: { configurable: true, enumerable: true, get: () => getCanvasControlMargin(node, 'bottom'), set: (value: number) => setCanvasControlMargin(node, 'bottom', value) },
    margin_left: { configurable: true, enumerable: true, get: () => getCanvasControlMargin(node, 'left'), set: (value: number) => setCanvasControlMargin(node, 'left', value) },
    margin_top: { configurable: true, enumerable: true, get: () => getCanvasControlMargin(node, 'top'), set: (value: number) => setCanvasControlMargin(node, 'top', value) },
    margin_right: { configurable: true, enumerable: true, get: () => getCanvasControlMargin(node, 'right'), set: (value: number) => setCanvasControlMargin(node, 'right', value) },
    margin_bottom: { configurable: true, enumerable: true, get: () => getCanvasControlMargin(node, 'bottom'), set: (value: number) => setCanvasControlMargin(node, 'bottom', value) },
    anchors_preset: { configurable: true, enumerable: true, get: () => getCanvasControlAnchorsPreset(node), set: (value: number) => setCanvasControlAnchorsPreset(node, value, false) },
    custom_minimum_size: { configurable: true, enumerable: true, get: () => getCanvasControlCustomMinimumSize(node), set: (value: ControlPoint) => setCanvasControlCustomMinimumSize(node, value) },
    size_flags_horizontal: { configurable: true, enumerable: true, get: () => getCanvasControlHorizontalSizeFlags(node), set: (value: number) => setCanvasControlHorizontalSizeFlags(node, value) },
    size_flags_vertical: { configurable: true, enumerable: true, get: () => getCanvasControlVerticalSizeFlags(node), set: (value: number) => setCanvasControlVerticalSizeFlags(node, value) },
    size_flags_stretch_ratio: { configurable: true, enumerable: true, get: () => getCanvasControlStretchRatio(node), set: (value: number) => setCanvasControlStretchRatio(node, value) },
    mouse_filter: { configurable: true, enumerable: true, get: () => getCanvasControlMouseFilter(node), set: (value: number) => setCanvasControlMouseFilter(node, value) },
    global_position: { configurable: true, enumerable: true, get: () => getCanvasControlGlobalPosition(node), set: (value: ControlPoint) => setCanvasControlGlobalPosition(node, value) },
  });
  Object.assign(node, {
    set_position: (value: ControlPoint, keepOffsets = false): void => setCanvasControlPositionWithOffsets(node, value, keepOffsets),
    get_position: (): ControlPoint => getCanvasControlPosition(node),
    set_global_position: (value: ControlPoint, keepOffsets = false): void => {
      const local = node.parent?.toLocal(value as PointData) ?? value;
      setCanvasControlPositionWithOffsets(node, local, keepOffsets);
    },
    get_global_position: (): ControlPoint => getCanvasControlGlobalPosition(node),
    set_size: (value: ControlPoint, keepOffsets = false): void => setCanvasControlSizeWithOffsets(node, value, keepOffsets),
    get_size: (): ControlPoint => getCanvasControlSize(node),
    set_custom_minimum_size: (value: ControlPoint): void => setCanvasControlCustomMinimumSize(node, value),
    get_custom_minimum_size: (): ControlPoint => getCanvasControlCustomMinimumSize(node),
    get_minimum_size: (): ControlPoint => copy(minimumOf(node, stateOf(node))),
    get_combined_minimum_size: (): ControlPoint => copy(minimumOf(node, stateOf(node))),
    reset_size: (): void => setCanvasControlSize(node, minimumOf(node, stateOf(node))),
    set_anchor: (side: number, anchor: number, keepOffset = false, pushOppositeAnchor = true): void => setCanvasControlAnchor(node, side, anchor, keepOffset, pushOppositeAnchor),
    get_anchor: (side: number): number => {
      const state = stateOf(node);
      if (side === 0) return state.anchorLeft;
      if (side === 1) return state.anchorTop;
      if (side === 2) return state.anchorRight;
      if (side === 3) return state.anchorBottom;
      throw new RangeError('Control.get_anchor side must be LEFT (0) through BOTTOM (3).');
    },
    set_offset: (side: number, offset: number): void => setCanvasControlMargin(node, controlSide(side, 'Control.set_offset'), offset),
    get_offset: (side: number): number => getCanvasControlMargin(node, controlSide(side, 'Control.get_offset')),
    set_anchor_and_offset: (side: number, anchor: number, offset: number, pushOppositeAnchor = false): void => {
      setCanvasControlAnchor(node, side, anchor, false, pushOppositeAnchor);
      setCanvasControlMargin(node, controlSide(side, 'Control.set_anchor_and_offset'), offset);
    },
    set_anchors_preset: (preset: number, keepOffsets = false): void => setCanvasControlAnchorsPreset(node, preset, keepOffsets),
    set_anchors_and_offsets_preset: (preset: number, resizeMode = 0, margin = 0): void => setCanvasControlAnchorsAndOffsetsPreset(node, preset, resizeMode, margin),
    get_anchors_preset: (): number => getCanvasControlAnchorsPreset(node),
    set_h_size_flags: (value: number): void => setCanvasControlHorizontalSizeFlags(node, value),
    get_h_size_flags: (): number => getCanvasControlHorizontalSizeFlags(node),
    set_v_size_flags: (value: number): void => setCanvasControlVerticalSizeFlags(node, value),
    get_v_size_flags: (): number => getCanvasControlVerticalSizeFlags(node),
    set_stretch_ratio: (value: number): void => setCanvasControlStretchRatio(node, value),
    get_stretch_ratio: (): number => getCanvasControlStretchRatio(node),
    set_mouse_filter: (value: number): void => setCanvasControlMouseFilter(node, value),
    get_mouse_filter: (): number => getCanvasControlMouseFilter(node),
    get_rect: (): GodotRect2 => getCanvasControlRect(node),
    get_global_rect: (): GodotRect2 => getCanvasControlGlobalRect(node),
    get_parent_area_size: (): ControlPoint => copy(controlParentRect(node, 'Control.get_parent_area_size').size),
    get_parent_control: (): Container | null => {
      let parent = node.parent;
      while (parent !== null) {
        if (canvasControls.has(parent)) return parent;
        parent = parent.parent;
      }
      return null;
    },
    get_screen_position: (): ControlPoint => getCanvasControlGlobalPosition(node),
    set_begin: (value: ControlPoint): void => {
      const next = copy(value);
      setCanvasControlMargin(node, 'left', next.x);
      setCanvasControlMargin(node, 'top', next.y);
    },
    get_begin: (): ControlPoint => ({
      x: getCanvasControlMargin(node, 'left'),
      y: getCanvasControlMargin(node, 'top'),
    }),
    set_end: (value: ControlPoint): void => {
      const next = copy(value);
      setCanvasControlMargin(node, 'right', next.x);
      setCanvasControlMargin(node, 'bottom', next.y);
    },
    get_end: (): ControlPoint => ({
      x: getCanvasControlMargin(node, 'right'),
      y: getCanvasControlMargin(node, 'bottom'),
    }),
    get_mouse_filter_with_override: (): number => getCanvasControlMouseFilter(node),
    fit_child_in_rect: (child: Container, rect: GodotRect2): void => {
      setCanvasControlPosition(child, rect.position);
      setCanvasControlSize(child, rect.size);
    },
  });
  return node;
}

export function releaseCanvasControl(node: Container): void {
  const state = canvasControls.get(node);
  if (state === undefined) return;
  state.releaseLayoutDirection?.();
  for (const event of GUI_POINTER_EVENTS) node.off(event, state.stopPropagation);
  node.off('pointerdown', state.routePointer);
  node.off('pointerup', state.routePointer);
  node.off('pointerupoutside', state.routePointer);
  node.off('pointermove', state.routePointer);
  node.off('pointercancel', state.routePointer);
  node.off('pointerenter', state.emitMouseEntered);
  releaseControlSignals(node);
  canvasControls.delete(node);
  releaseControlBinding(node);
  setControlThemeParent(node);
}

export function getCanvasControlPosition(node: Container): ControlPoint {
  return copy(stateOf(node).position);
}

export function setCanvasControlPosition(node: Container, value: unknown): void {
  setCanvasControlPositionWithOffsets(node, value, false);
}

/** Control::set_position: either recompute offsets or anchors around the requested retained rect. */
export function setCanvasControlPositionWithOffsets(
  node: Container,
  value: unknown,
  keepOffsets = false,
): void {
  if (typeof keepOffsets !== 'boolean') {
    throw new TypeError('Control.set_position keep_offsets requires bool.');
  }
  const state = stateOf(node);
  const position = copy(value);
  const parent = controlParentRect(node, 'Control.set_position');
  const left = position.x - parent.position.x;
  const top = position.y - parent.position.y;
  const right = left + state.size.x;
  const bottom = top + state.size.y;
  if (keepOffsets) {
    // Godot's _compute_anchors ERR_FAIL_COND path leaves the rect unchanged for either zero axis.
    if (parent.size.x === 0 || parent.size.y === 0) return;
    state.anchorLeft = (left - state.margins.left) / parent.size.x;
    state.anchorTop = (top - state.margins.top) / parent.size.y;
    state.anchorRight = (right - state.margins.right) / parent.size.x;
    state.anchorBottom = (bottom - state.margins.bottom) / parent.size.y;
  } else {
    state.margins.left = left - state.anchorLeft * parent.size.x;
    state.margins.top = top - state.anchorTop * parent.size.y;
    state.margins.right = right - state.anchorRight * parent.size.x;
    state.margins.bottom = bottom - state.anchorBottom * parent.size.y;
  }
  state.position = position;
  applyRect(node, state);
  reflowParent(node);
}

/** Godot's container stretch weight. Zero is legal and means the Control receives no share. */
export function getCanvasControlStretchRatio(node: Container): number {
  return stateOf(node).stretchRatio;
}

export function setCanvasControlStretchRatio(node: Container, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('Control.size_flags_stretch_ratio must be a finite non-negative number.');
  }
  const state = stateOf(node);
  state.stretchRatio = value;
  reflowParent(node);
}

export function getCanvasControlGlobalPosition(node: Container): ControlPoint {
  const state = stateOf(node);
  const point = node.parent?.toGlobal({ x: state.position.x, y: state.position.y } as PointData) ?? state.position;
  return { x: point.x, y: point.y };
}

export function setCanvasControlGlobalPosition(node: Container, value: ControlPoint): void {
  const local = node.parent?.toLocal(value as PointData) ?? value;
  setCanvasControlPosition(node, local);
}

export function getCanvasControlScale(node: Container): ControlPoint {
  return { x: node.scale.x, y: node.scale.y };
}

export function setCanvasControlScale(node: Container, value: ControlPoint): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError('Godot Control.rect_scale requires a finite Vector2.');
  }
  node.scale.set(value.x, value.y);
}

export function getCanvasControlSize(node: Container): ControlPoint {
  return copy(stateOf(node).size);
}

export function getCanvasControlRect(node: Container): GodotRect2 {
  const size = stateOf(node).size;
  return godotRect2New(0, 0, size.x, size.y);
}

/** Axis-aligned global Control rect after the retained Pixi parent transform. */
export function getCanvasControlGlobalRect(node: Container): GodotRect2 {
  const state = stateOf(node);
  const parent = node.parent;
  const corners = [
    { x: state.position.x, y: state.position.y },
    { x: state.position.x + state.size.x, y: state.position.y },
    { x: state.position.x, y: state.position.y + state.size.y },
    { x: state.position.x + state.size.x, y: state.position.y + state.size.y },
  ].map((point) => parent?.toGlobal(point as PointData) ?? point);
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return godotRect2New(left, top, right - left, bottom - top);
}

export function getCanvasControlAnchorRight(node: Container): number {
  return stateOf(node).anchorRight;
}

export function getCanvasControlAnchorLeft(node: Container): number {
  return stateOf(node).anchorLeft;
}

export function setCanvasControlAnchorLeft(node: Container, value: number): void {
  setCanvasControlAnchor(node, 0, value);
}

export function getCanvasControlAnchorTop(node: Container): number {
  return stateOf(node).anchorTop;
}

export function setCanvasControlAnchorTop(node: Container, value: number): void {
  setCanvasControlAnchor(node, 1, value);
}

export function setCanvasControlAnchorRight(node: Container, value: number): void {
  setCanvasControlAnchor(node, 2, value);
}

export function getCanvasControlAnchorBottom(node: Container): number {
  return stateOf(node).anchorBottom;
}

export function setCanvasControlAnchorBottom(node: Container, value: number): void {
  setCanvasControlAnchor(node, 3, value);
}

/** Godot 3/4 Control::set_anchor over the retained anchor/offset quartet. */
export function setCanvasControlAnchor(
  node: Container,
  side: number,
  value: number,
  keepOffset = false,
  pushOppositeAnchor = true,
): void {
  if (!Number.isSafeInteger(side) || side < 0 || side > 3) {
    throw new RangeError('Control.set_anchor side must be LEFT, TOP, RIGHT, or BOTTOM.');
  }
  if (typeof keepOffset !== 'boolean' || typeof pushOppositeAnchor !== 'boolean') {
    throw new TypeError('Control.set_anchor keep_offset and push_opposite_anchor require bool.');
  }
  const state = stateOf(node);
  const anchor = finiteAnchor(value, 'Control.set_anchor');
  const parent = controlParentRect(node, 'Control.set_anchor');
  const anchors: [number, number, number, number] = [
    state.anchorLeft, state.anchorTop, state.anchorRight, state.anchorBottom,
  ];
  const offsets: [number, number, number, number] = [
    state.margins.left, state.margins.top, state.margins.right, state.margins.bottom,
  ];
  const checkedSide = side as 0 | 1 | 2 | 3;
  const opposite = ((checkedSide + 2) % 4) as 0 | 1 | 2 | 3;
  const range = checkedSide === 0 || checkedSide === 2 ? parent.size.x : parent.size.y;
  const previousPosition = offsets[checkedSide] + anchors[checkedSide] * range;
  const previousOppositePosition = offsets[opposite] + anchors[opposite] * range;
  anchors[checkedSide] = anchor;
  const crossed = checkedSide < 2
    ? anchors[checkedSide] > anchors[opposite]
    : anchors[checkedSide] < anchors[opposite];
  if (crossed) {
    if (pushOppositeAnchor) anchors[opposite] = anchors[checkedSide];
    else anchors[checkedSide] = anchors[opposite];
  }
  if (!keepOffset) {
    offsets[checkedSide] = previousPosition - anchors[checkedSide] * range;
    if (pushOppositeAnchor) {
      offsets[opposite] = previousOppositePosition - anchors[opposite] * range;
    }
  }
  state.anchorLeft = anchors[0];
  state.anchorTop = anchors[1];
  state.anchorRight = anchors[2];
  state.anchorBottom = anchors[3];
  state.margins.left = offsets[0];
  state.margins.top = offsets[1];
  state.margins.right = offsets[2];
  state.margins.bottom = offsets[3];
  applyAnchoredOffsets(node, state, 'Control.set_anchor');
}

const CONTROL_PRESET_ANCHORS = [
  [0, 0, 0, 0], [1, 0, 1, 0], [0, 1, 0, 1], [1, 1, 1, 1],
  [0, 0.5, 0, 0.5], [0.5, 0, 0.5, 0], [1, 0.5, 1, 0.5], [0.5, 1, 0.5, 1],
  [0.5, 0.5, 0.5, 0.5], [0, 0, 0, 1], [0, 0, 1, 0], [1, 0, 1, 1],
  [0, 1, 1, 1], [0.5, 0, 0.5, 1], [0, 0.5, 1, 0.5], [0, 0, 1, 1],
] as const;

function controlPreset(value: number, member: string): readonly [number, number, number, number] {
  if (!Number.isSafeInteger(value) || value < 0 || value >= CONTROL_PRESET_ANCHORS.length) {
    throw new RangeError(`${member} preset must be a LayoutPreset integer in [0, 15].`);
  }
  return CONTROL_PRESET_ANCHORS[value] as readonly [number, number, number, number];
}

/** Serialized Control.anchors_preset inferred from the exact retained anchor quartet. */
export function getCanvasControlAnchorsPreset(node: Container): number {
  const state = stateOf(node);
  return CONTROL_PRESET_ANCHORS.findIndex(([left, top, right, bottom]) =>
    state.anchorLeft === left && state.anchorTop === top &&
    state.anchorRight === right && state.anchorBottom === bottom);
}

/** Exact Control::set_anchors_preset over the retained anchor/offset rectangle. */
export function setCanvasControlAnchorsPreset(node: Container, preset: number, keepOffsets = false): void {
  if (typeof keepOffsets !== 'boolean') {
    throw new TypeError('Control.set_anchors_preset keep_offsets requires bool.');
  }
  const state = stateOf(node);
  const [left, top, right, bottom] = controlPreset(preset, 'Control.set_anchors_preset');
  if (!keepOffsets) {
    const parent = controlParentRect(node, 'Control.set_anchors_preset');
    state.margins.left += (state.anchorLeft - left) * parent.size.x;
    state.margins.top += (state.anchorTop - top) * parent.size.y;
    state.margins.right += (state.anchorRight - right) * parent.size.x;
    state.margins.bottom += (state.anchorBottom - bottom) * parent.size.y;
  }
  state.anchorLeft = left;
  state.anchorTop = top;
  state.anchorRight = right;
  state.anchorBottom = bottom;
  if (keepOffsets) applyAnchoredOffsets(node, state, 'Control.set_anchors_preset');
}

/** Exact Control::set_anchors_and_offsets_preset / Godot 3 margins alias. */
export function setCanvasControlAnchorsAndOffsetsPreset(
  node: Container,
  preset: number,
  resizeMode = 0,
  margin = 0,
): void {
  if (!Number.isSafeInteger(resizeMode) || resizeMode < 0 || resizeMode > 3) {
    throw new RangeError('Control.set_anchors_and_offsets_preset resize_mode must be a LayoutPresetMode in [0, 3].');
  }
  if (!Number.isSafeInteger(margin)) {
    throw new TypeError('Control.set_anchors_and_offsets_preset margin requires an integer.');
  }
  const state = stateOf(node);
  const parent = controlParentRect(node, 'Control.set_anchors_and_offsets_preset');
  setCanvasControlAnchorsPreset(node, preset, false);
  const minimum = intrinsicMinimumOf(node, state);
  const size = {
    x: resizeMode === 0 || resizeMode === 2 ? minimum.x : state.size.x,
    y: resizeMode === 0 || resizeMode === 1 ? minimum.y : state.size.y,
  };
  const horizontal = [1, 3, 6, 11].includes(preset)
    ? 'end'
    : [5, 7, 8, 13].includes(preset)
      ? 'center'
      : [10, 12, 14, 15].includes(preset)
        ? 'wide'
        : 'begin';
  const vertical = [2, 3, 7, 12].includes(preset)
    ? 'end'
    : [4, 6, 8, 14].includes(preset)
      ? 'center'
      : [9, 11, 13, 15].includes(preset)
        ? 'wide'
        : 'begin';
  const left = horizontal === 'end'
    ? parent.size.x - size.x - margin
    : horizontal === 'center'
      ? (parent.size.x - size.x) / 2
      : margin;
  const right = horizontal === 'wide' ? parent.size.x - margin : left + size.x;
  const top = vertical === 'end'
    ? parent.size.y - size.y - margin
    : vertical === 'center'
      ? (parent.size.y - size.y) / 2
      : margin;
  const bottom = vertical === 'wide' ? parent.size.y - margin : top + size.y;
  state.margins.left = left - state.anchorLeft * parent.size.x;
  state.margins.top = top - state.anchorTop * parent.size.y;
  state.margins.right = right - state.anchorRight * parent.size.x;
  state.margins.bottom = bottom - state.anchorBottom * parent.size.y;
  applyAnchoredOffsets(node, state, 'Control.set_anchors_and_offsets_preset');
}

export function getCanvasControlFont(node: Container, name: string): GodotFont {
  if (typeof name !== 'string') throw new TypeError('Control.get_font requires a StringName.');
  const state = stateOf(node);
  const themed = controlThemeFont(node, name, state.defaultThemeType);
  if (typeof themed === 'object' && themed !== null) return themed as GodotFont;
  state.fallbackFont ??= createGodotRenderedFont(3, state.fallbackFontFamily, state.fallbackFontSize);
  return state.fallbackFont;
}

type CanvasMargin = 'left' | 'top' | 'right' | 'bottom';

export function getCanvasControlMargin(node: Container, side: CanvasMargin): number {
  return stateOf(node).margins[side];
}

export function setCanvasControlMargin(node: Container, side: CanvasMargin, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError(`Control.margin_${side} requires a finite number.`);
  const state = stateOf(node);
  const previous = state.margins[side];
  if (side === 'left') {
    state.position = { x: state.position.x + value - previous, y: state.position.y };
    state.size = { x: state.size.x - value + previous, y: state.size.y };
  } else if (side === 'right') {
    state.size = { x: state.size.x + value - previous, y: state.size.y };
  } else if (side === 'top') {
    state.position = { x: state.position.x, y: state.position.y + value - previous };
    state.size = { x: state.size.x, y: state.size.y - value + previous };
  } else {
    state.size = { x: state.size.x, y: state.size.y + value - previous };
  }
  state.margins[side] = value;
  applyRect(node, state);
  reflowCanvasContainer(node);
  reflowParent(node);
}

export function setCanvasControlSize(node: Container, value: ControlPoint): void {
  setCanvasControlSizeWithOffsets(node, value, false);
}

/** Control::set_size: minimum-clamp once, then preserve either offsets or anchors exactly. */
export function setCanvasControlSizeWithOffsets(
  node: Container,
  value: ControlPoint,
  keepOffsets = false,
): void {
  if (typeof keepOffsets !== 'boolean') {
    throw new TypeError('Control.set_size keep_offsets requires bool.');
  }
  const state = stateOf(node);
  const requested = copy(value);
  const minimum = minimumOf(node, state);
  const size = {
    x: Math.max(requested.x, minimum.x),
    y: Math.max(requested.y, minimum.y),
  };
  const parent = controlParentRect(node, 'Control.set_size');
  const left = state.position.x - parent.position.x;
  const top = state.position.y - parent.position.y;
  const right = left + size.x;
  const bottom = top + size.y;
  if (keepOffsets) {
    // Godot's _compute_anchors ERR_FAIL_COND path leaves the rect unchanged for either zero axis.
    if (parent.size.x === 0 || parent.size.y === 0) return;
    state.anchorLeft = (left - state.margins.left) / parent.size.x;
    state.anchorTop = (top - state.margins.top) / parent.size.y;
    state.anchorRight = (right - state.margins.right) / parent.size.x;
    state.anchorBottom = (bottom - state.margins.bottom) / parent.size.y;
  } else {
    state.margins.left = left - state.anchorLeft * parent.size.x;
    state.margins.top = top - state.anchorTop * parent.size.y;
    state.margins.right = right - state.anchorRight * parent.size.x;
    state.margins.bottom = bottom - state.anchorBottom * parent.size.y;
  }
  state.size = size;
  applyRect(node, state);
  reflowCanvasContainer(node);
  reflowParent(node);
}

export function getCanvasControlCustomMinimumSize(node: Container): ControlPoint {
  return copy(stateOf(node).customMinimumSize);
}

export function setCanvasControlCustomMinimumSize(node: Container, value: ControlPoint): void {
  const state = stateOf(node);
  state.customMinimumSize = copy(value);
  state.size = {
    x: Math.max(state.size.x, state.customMinimumSize.x),
    y: Math.max(state.size.y, state.customMinimumSize.y),
  };
  applyRect(node, state);
  reflowCanvasContainer(node);
  reflowParent(node);
}

export function getCanvasControlCustomMaximumSize(node: Container): ControlPoint {
  return copy(stateOf(node).customMaximumSize);
}

export function setCanvasControlCustomMaximumSize(node: Container, value: ControlPoint): void {
  const next = copy(value);
  if (next.x < 0 || next.y < 0) {
    throw new RangeError('Control.custom_maximum_size components must be non-negative.');
  }
  const state = stateOf(node);
  state.customMaximumSize = next;
  applyRect(node, state);
  reflowCanvasContainer(node);
  reflowParent(node);
}

export function getCanvasControlHorizontalSizeFlags(node: Container): number {
  return stateOf(node).sizeFlagsHorizontal;
}

export function setCanvasControlHorizontalSizeFlags(node: Container, value: number): void {
  stateOf(node).sizeFlagsHorizontal = flags(value);
  reflowParent(node);
}

export function getCanvasControlVerticalSizeFlags(node: Container): number {
  return stateOf(node).sizeFlagsVertical;
}

export function setCanvasControlVerticalSizeFlags(node: Container, value: number): void {
  stateOf(node).sizeFlagsVertical = flags(value);
  reflowParent(node);
}

export function getCanvasControlMouseFilter(node: Container): number {
  return stateOf(node).mouseFilter;
}

export function setCanvasControlMouseFilter(node: Container, value: number): void {
  const state = stateOf(node);
  state.mouseFilter = filter(value);
  node.eventMode = state.mouseFilter === 2 ? 'passive' : 'static';
}

export function setCanvasContainerLayout(
  node: Container,
  layout: CanvasContainerLayout,
  options: {
    readonly separation?: number;
    readonly rowSeparation?: number;
    readonly columns?: number;
    readonly alignment?: 0 | 1 | 2;
    readonly lastWrapAlignment?: 0 | 1 | 2 | 3;
    readonly reverseFill?: boolean;
    readonly splitOffset?: number;
    readonly splitCollapsed?: boolean;
    readonly aspectRatio?: number;
    readonly stretchMode?: number;
    readonly verticalAlignment?: 0 | 1 | 2;
    readonly centerUseTopLeft?: boolean;
    readonly contentInsets?: Readonly<{ left: number; top: number; right: number; bottom: number }>;
    readonly onLayout?: () => void;
  } = {},
): void {
  const state = stateOf(node);
  if (options.separation !== undefined && (!Number.isFinite(options.separation) || options.separation < 0)) {
    throw new RangeError('Container separation must be finite and non-negative.');
  }
  if (options.rowSeparation !== undefined && (!Number.isFinite(options.rowSeparation) || options.rowSeparation < 0)) {
    throw new RangeError('GridContainer row separation must be finite and non-negative.');
  }
  if (options.columns !== undefined && (!Number.isSafeInteger(options.columns) || options.columns < 1)) {
    throw new RangeError('GridContainer.columns must be a positive integer.');
  }
  if (options.alignment !== undefined && (!Number.isSafeInteger(options.alignment) || options.alignment < 0 || options.alignment > 2)) {
    throw new RangeError('Container alignment must be BEGIN (0), CENTER (1), or END (2).');
  }
  if (options.lastWrapAlignment !== undefined && (!Number.isSafeInteger(options.lastWrapAlignment) || options.lastWrapAlignment < 0 || options.lastWrapAlignment > 3)) {
    throw new RangeError('FlowContainer.last_wrap_alignment must be BEGIN (0) through INHERIT (3).');
  }
  if (options.reverseFill !== undefined && typeof options.reverseFill !== 'boolean') {
    throw new TypeError('FlowContainer.reverse_fill must be bool.');
  }
  if (options.splitOffset !== undefined && !Number.isFinite(options.splitOffset)) {
    throw new RangeError('SplitContainer.split_offset must be finite.');
  }
  if (options.splitCollapsed !== undefined && typeof options.splitCollapsed !== 'boolean') {
    throw new TypeError('SplitContainer.collapsed must be bool.');
  }
  if (options.aspectRatio !== undefined && (!Number.isFinite(options.aspectRatio) || options.aspectRatio <= 0)) {
    throw new RangeError('AspectRatioContainer.ratio must be finite and greater than zero.');
  }
  if (options.stretchMode !== undefined && (!Number.isSafeInteger(options.stretchMode) || options.stretchMode < 0 || options.stretchMode > 3)) {
    throw new RangeError('AspectRatioContainer.stretch_mode must be 0 through 3.');
  }
  if (options.verticalAlignment !== undefined && (!Number.isSafeInteger(options.verticalAlignment) || options.verticalAlignment < 0 || options.verticalAlignment > 2)) {
    throw new RangeError('AspectRatioContainer.alignment_vertical must be BEGIN (0), CENTER (1), or END (2).');
  }
  if (options.centerUseTopLeft !== undefined && typeof options.centerUseTopLeft !== 'boolean') {
    throw new TypeError('CenterContainer.use_top_left must be bool.');
  }
  if (options.contentInsets !== undefined &&
      ![options.contentInsets.left, options.contentInsets.top, options.contentInsets.right, options.contentInsets.bottom]
        .every((value) => Number.isFinite(value) && value >= 0)) {
    throw new RangeError('Container content insets must be finite and non-negative.');
  }
  state.containerLayout = layout;
  if (options.separation !== undefined) state.separation = options.separation;
  if (options.rowSeparation !== undefined) state.rowSeparation = options.rowSeparation;
  if (options.columns !== undefined) state.columns = options.columns;
  if (options.alignment !== undefined) state.alignment = options.alignment;
  if (options.lastWrapAlignment !== undefined) state.lastWrapAlignment = options.lastWrapAlignment;
  if (options.reverseFill !== undefined) state.reverseFill = options.reverseFill;
  if (options.splitOffset !== undefined) state.splitOffset = options.splitOffset;
  if (options.splitCollapsed !== undefined) state.splitCollapsed = options.splitCollapsed;
  if (options.aspectRatio !== undefined) state.aspectRatio = options.aspectRatio;
  if (options.stretchMode !== undefined) state.stretchMode = options.stretchMode;
  if (options.verticalAlignment !== undefined) state.verticalAlignment = options.verticalAlignment;
  if (options.centerUseTopLeft !== undefined) state.centerUseTopLeft = options.centerUseTopLeft;
  if (options.contentInsets !== undefined) state.contentInsets = { ...options.contentInsets };
  if (options.onLayout !== undefined) state.onContainerLayout = options.onLayout;
  reflowCanvasContainer(node);
}

/** Center of the retained native SplitContainer dragger after minimum-size clamping. */
export function getCanvasSplitDividerPosition(node: Container): number {
  const state = stateOf(node);
  if (state.containerLayout !== 'split-horizontal' && state.containerLayout !== 'split-vertical') {
    throw new Error('Canvas Control is not bound as a SplitContainer.');
  }
  return state.splitDivider;
}

export function clearCanvasContainerLayoutObserver(node: Container): void {
  const state = canvasControls.get(node);
  if (state !== undefined) delete state.onContainerLayout;
}

export function setCanvasContainerScroll(node: Container, value: ControlPoint): void {
  const state = stateOf(node);
  const next = copy(value);
  if (next.x < 0 || next.y < 0) throw new RangeError('ScrollContainer scroll values must be non-negative.');
  state.scroll = next;
  reflowCanvasContainer(node);
}

export function reflowCanvasControl(node: Container): void {
  reflowCanvasContainer(node);
}
