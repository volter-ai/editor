/** Pixi-native retained FlowContainer, SplitContainer, and AspectRatioContainer behavior. */

import { Container, Graphics, type FederatedPointerEvent } from 'pixi.js';

import {
  clearCanvasContainerLayoutObserver,
  getCanvasSplitDividerPosition,
  setCanvasContainerLayout,
} from './canvas-control-state';
import { bindRuntimeCanvasControl, markInternalCanvasChild, registerCanvasNodeRelease } from './node';
import { bindGodotCanvasContainerApi } from './canvas-container';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { registerGodotObjectIdentity } from './object';

function integer(member: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function finite(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${member} must be finite.`);
  return value;
}

function boolean(member: string, value: boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be bool.`);
  return value;
}

function firstDraggerIndex(member: string, value = 0): void {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${member} index must be an integer.`);
  if (value !== 0) throw new RangeError(`${member} index ${value} requires multi-child SplitContainer support.`);
}

interface CanvasLayoutState {
  readonly kind: 'flow' | 'split' | 'aspect';
  vertical: boolean;
  fixed: boolean;
  dragged?: SignalHandle<readonly [number]>;
  dragger?: Graphics;
  alignment: 0 | 1 | 2;
  lastWrapAlignment: 0 | 1 | 2 | 3;
  reverseFill: boolean;
  splitOffset: number;
  collapsed: boolean;
  draggable: boolean;
  draggerVisibility: 0 | 1 | 2;
  ratio: number;
  stretchMode: 0 | 1 | 2 | 3;
  verticalAlignment: 0 | 1 | 2;
  width: number;
  height: number;
  separation: number;
  pointerDown?(event: FederatedPointerEvent): void;
  pointerMove?(event: FederatedPointerEvent): void;
  pointerUp?(): void;
  dragging: boolean;
  unregisterRelease(): void;
  released: boolean;
}

const LAYOUTS = new WeakMap<Container, CanvasLayoutState>();

function base(
  node: Container,
  kind: CanvasLayoutState['kind'],
  vertical: boolean,
): CanvasLayoutState {
  releaseCanvasLayoutContainer(node);
  const state: CanvasLayoutState = {
    kind,
    vertical: boolean('Container vertical orientation', vertical),
    fixed: false,
    alignment: 0,
    lastWrapAlignment: 3,
    reverseFill: false,
    splitOffset: 0,
    collapsed: false,
    draggable: true,
    draggerVisibility: 0,
    ratio: 1,
    stretchMode: 2,
    verticalAlignment: 1,
    width: 0,
    height: 0,
    separation: 0,
    dragging: false,
    unregisterRelease: () => {},
    released: false,
  };
  LAYOUTS.set(node, state);
  state.unregisterRelease = registerCanvasNodeRelease(node, () => releaseCanvasLayoutContainer(node));
  return state;
}

export type GodotCanvasFlowContainer = Container & {
  vertical: boolean;
  alignment: number;
  last_wrap_alignment: number;
  reverse_fill: boolean;
  get_alignment(): number;
  set_alignment(value: number): void;
  get_last_wrap_alignment(): number;
  set_last_wrap_alignment(value: number): void;
  is_reverse_fill(): boolean;
  set_reverse_fill(value: boolean): void;
  is_vertical(): boolean;
  set_vertical(value: boolean): void;
};

export function bindCanvasFlowContainer(
  node: Container,
  options: {
    readonly vertical: boolean;
    readonly fixed?: boolean;
    readonly horizontalSeparation: number;
    readonly verticalSeparation: number;
    readonly alignment?: number;
    readonly lastWrapAlignment?: number;
    readonly reverseFill?: boolean;
  },
): GodotCanvasFlowContainer {
  const state = base(node, 'flow', options.vertical);
  state.fixed = options.fixed ?? false;
  state.alignment = integer('FlowContainer.alignment', options.alignment ?? 0, 0, 2) as 0 | 1 | 2;
  state.lastWrapAlignment = integer('FlowContainer.last_wrap_alignment', options.lastWrapAlignment ?? 3, 0, 3) as 0 | 1 | 2 | 3;
  state.reverseFill = boolean('FlowContainer.reverse_fill', options.reverseFill ?? false);
  const apply = (): void => setCanvasContainerLayout(
    node,
    state.vertical ? 'flow-vertical' : 'flow-horizontal',
    {
      separation: finite(
        'FlowContainer horizontal separation',
        options.horizontalSeparation,
      ),
      rowSeparation: finite(
        'FlowContainer vertical separation',
        options.verticalSeparation,
      ),
      alignment: state.alignment,
      lastWrapAlignment: state.lastWrapAlignment,
      reverseFill: state.reverseFill,
    },
  );
  Object.defineProperties(node, {
    vertical: { enumerable: true, configurable: true, get: () => state.vertical, set: (value: boolean) => { if (state.fixed) throw new Error(`Can't change orientation of fixed FlowContainer subclass.`); state.vertical = boolean('FlowContainer.vertical', value); apply(); } },
    alignment: { enumerable: true, configurable: true, get: () => state.alignment, set: (value: number) => { state.alignment = integer('FlowContainer.alignment', value, 0, 2) as 0 | 1 | 2; apply(); } },
    last_wrap_alignment: { enumerable: true, configurable: true, get: () => state.lastWrapAlignment, set: (value: number) => { state.lastWrapAlignment = integer('FlowContainer.last_wrap_alignment', value, 0, 3) as 0 | 1 | 2 | 3; apply(); } },
    reverse_fill: { enumerable: true, configurable: true, get: () => state.reverseFill, set: (value: boolean) => { state.reverseFill = boolean('FlowContainer.reverse_fill', value); apply(); } },
  });
  const flow = node as GodotCanvasFlowContainer;
  flow.get_alignment = (): number => state.alignment;
  flow.set_alignment = (value: number): void => { flow.alignment = value; };
  flow.get_last_wrap_alignment = (): number => state.lastWrapAlignment;
  flow.set_last_wrap_alignment = (value: number): void => { flow.last_wrap_alignment = value; };
  flow.is_reverse_fill = (): boolean => state.reverseFill;
  flow.set_reverse_fill = (value: boolean): void => { flow.reverse_fill = value; };
  flow.is_vertical = (): boolean => state.vertical;
  flow.set_vertical = (value: boolean): void => { flow.vertical = value; };
  apply();
  return flow;
}

/** Runtime `HFlowContainer.new()` using the same native Pixi flow solver as authored controls. */
export function createGodotCanvasHFlowContainer(): GodotCanvasFlowContainer {
  const node = bindCanvasFlowContainer(bindRuntimeCanvasControl(new Container()), {
    vertical: false,
    fixed: true,
    horizontalSeparation: 4,
    verticalSeparation: 4,
  });
  bindGodotCanvasContainerApi(node);
  registerGodotObjectIdentity(node, 'HFlowContainer');
  return node;
}

/** Runtime base `FlowContainer.new()` defaults to horizontal and remains orientation-mutable. */
export function createGodotCanvasFlowContainer(): GodotCanvasFlowContainer {
  const node = bindCanvasFlowContainer(bindRuntimeCanvasControl(new Container()), {
    vertical: false,
    fixed: false,
    horizontalSeparation: 4,
    verticalSeparation: 4,
  });
  bindGodotCanvasContainerApi(node);
  registerGodotObjectIdentity(node, 'FlowContainer');
  return node;
}

/** Runtime `VFlowContainer.new()` using the shared native Pixi flow solver. */
export function createGodotCanvasVFlowContainer(): GodotCanvasFlowContainer {
  const node = bindCanvasFlowContainer(bindRuntimeCanvasControl(new Container()), {
    vertical: true,
    fixed: true,
    horizontalSeparation: 4,
    verticalSeparation: 4,
  });
  bindGodotCanvasContainerApi(node);
  registerGodotObjectIdentity(node, 'VFlowContainer');
  return node;
}

export type GodotCanvasSplitContainer = Container & {
  vertical: boolean;
  split_offset: number;
  collapsed: boolean;
  draggable: boolean;
  dragging_enabled: boolean;
  dragger_visibility: number;
  readonly dragged: GodotSignal<readonly [number]>;
  get_split_offset(index?: number): number;
  set_split_offset(value: number, index?: number): void;
  is_collapsed(): boolean;
  set_collapsed(value: boolean): void;
  is_draggable(): boolean;
  set_draggable(value: boolean): void;
  is_dragging_enabled(): boolean;
  set_dragging_enabled(value: boolean): void;
  get_dragger_visibility(): number;
  set_dragger_visibility(value: number): void;
  clamp_split_offset(index?: number): void;
  is_vertical(): boolean;
  set_vertical(value: boolean): void;
};

function redrawDragger(node: Container, state: CanvasLayoutState, separation: number): void {
  const dragger = state.dragger;
  if (dragger === undefined) return;
  const hidden = state.collapsed;
  dragger.visible = !hidden;
  dragger.eventMode = state.draggable && !hidden ? 'static' : 'none';
  dragger.clear();
  if (hidden) return;
  const middle = getCanvasSplitDividerPosition(node);
  const grabThickness = Math.max(4, separation);
  if (state.vertical) dragger.rect(0, middle - grabThickness / 2, state.width, grabThickness);
  else dragger.rect(middle - grabThickness / 2, 0, grabThickness, state.height);
  dragger.fill({ color: 0x5c6573, alpha: state.draggerVisibility === 0 ? 1 : 0.001 });
}

export function bindCanvasSplitContainer(
  node: Container,
  options: {
    readonly vertical: boolean;
    readonly fixed?: boolean;
    readonly width: number;
    readonly height: number;
    readonly separation: number;
    readonly splitOffset?: number;
    readonly collapsed?: boolean;
    readonly draggable?: boolean;
    readonly draggerVisibility?: number;
  },
): GodotCanvasSplitContainer {
  const state = base(node, 'split', options.vertical);
  state.fixed = options.fixed ?? false;
  state.width = finite('SplitContainer width', options.width);
  state.height = finite('SplitContainer height', options.height);
  state.splitOffset = finite('SplitContainer.split_offset', options.splitOffset ?? 0);
  state.collapsed = boolean('SplitContainer.collapsed', options.collapsed ?? false);
  state.draggable = boolean('SplitContainer.draggable', options.draggable ?? true);
  state.draggerVisibility = integer('SplitContainer.dragger_visibility', options.draggerVisibility ?? 0, 0, 2) as 0 | 1 | 2;
  const separation = finite('SplitContainer separation', options.separation);
  if (separation < 0) throw new RangeError('SplitContainer separation must be non-negative.');
  state.separation = separation;
  const dragged = createSignal<readonly [number]>();
  state.dragged = dragged;
  const dragger = markInternalCanvasChild(new Graphics());
  state.dragger = dragger;
  node.addChild(dragger);
  const apply = (): void => {
    const effectiveSeparation = state.draggerVisibility === 2 ? 0 : separation;
    setCanvasContainerLayout(node, state.vertical ? 'split-vertical' : 'split-horizontal', {
      separation: effectiveSeparation,
      splitOffset: state.splitOffset,
      splitCollapsed: state.collapsed,
      onLayout: () => redrawDragger(node, state, effectiveSeparation),
    });
  };
  const split = node as GodotCanvasSplitContainer;
  Object.defineProperties(split, {
    vertical: { enumerable: true, configurable: true, get: () => state.vertical, set: (value: boolean) => { if (state.fixed) throw new Error(`Can't change orientation of fixed SplitContainer subclass.`); state.vertical = boolean('SplitContainer.vertical', value); apply(); } },
    split_offset: { enumerable: true, configurable: true, get: () => state.splitOffset, set: (value: number) => { state.splitOffset = finite('SplitContainer.split_offset', value); apply(); } },
    collapsed: { enumerable: true, configurable: true, get: () => state.collapsed, set: (value: boolean) => { state.collapsed = boolean('SplitContainer.collapsed', value); apply(); } },
    draggable: { enumerable: true, configurable: true, get: () => state.draggable, set: (value: boolean) => { state.draggable = boolean('SplitContainer.draggable', value); apply(); } },
    dragging_enabled: { enumerable: true, configurable: true, get: () => state.draggable, set: (value: boolean) => { state.draggable = boolean('SplitContainer.dragging_enabled', value); apply(); } },
    dragger_visibility: { enumerable: true, configurable: true, get: () => state.draggerVisibility, set: (value: number) => { state.draggerVisibility = integer('SplitContainer.dragger_visibility', value, 0, 2) as 0 | 1 | 2; apply(); } },
    dragged: { enumerable: true, configurable: true, value: dragged.signal },
  });
  split.get_split_offset = (index = 0): number => { firstDraggerIndex('SplitContainer.get_split_offset', index); return state.splitOffset; };
  split.set_split_offset = (value: number, index = 0): void => { firstDraggerIndex('SplitContainer.set_split_offset', index); split.split_offset = value; };
  split.is_collapsed = (): boolean => state.collapsed;
  split.set_collapsed = (value: boolean): void => { split.collapsed = value; };
  split.is_draggable = (): boolean => state.draggable;
  split.set_draggable = (value: boolean): void => { split.draggable = value; };
  split.is_dragging_enabled = (): boolean => state.draggable;
  split.set_dragging_enabled = (value: boolean): void => { split.dragging_enabled = value; };
  split.get_dragger_visibility = (): number => state.draggerVisibility;
  split.set_dragger_visibility = (value: number): void => { split.dragger_visibility = value; };
  split.clamp_split_offset = (index = 0): void => {
    firstDraggerIndex('SplitContainer.clamp_split_offset', index);
    const extent = state.vertical ? state.height : state.width;
    split.split_offset = Math.min(Math.max(state.splitOffset, -extent / 2), extent / 2);
  };
  split.is_vertical = (): boolean => state.vertical;
  split.set_vertical = (value: boolean): void => { split.vertical = value; };
  state.pointerDown = (): void => { if (state.draggable && !state.collapsed) state.dragging = true; };
  state.pointerMove = (event: FederatedPointerEvent): void => {
    if (!state.dragging) return;
    const point = event.getLocalPosition(node);
    state.splitOffset = (state.vertical ? point.y - state.height / 2 : point.x - state.width / 2);
    apply();
    dragged.emit(state.splitOffset);
  };
  state.pointerUp = (): void => { state.dragging = false; };
  dragger.on('pointerdown', state.pointerDown);
  node.on('globalpointermove', state.pointerMove);
  node.on('pointerup', state.pointerUp);
  node.on('pointerupoutside', state.pointerUp);
  apply();
  return split;
}

export function createGodotCanvasHSplitContainer(): GodotCanvasSplitContainer {
  const node = bindRuntimeCanvasControl(new Container());
  registerGodotObjectIdentity(node, 'HSplitContainer');
  return bindGodotCanvasContainerApi(bindCanvasSplitContainer(node, {
    vertical: false, width: 0, height: 0, separation: 0,
  }));
}

export function createGodotCanvasSplitContainer(): GodotCanvasSplitContainer {
  const node = bindRuntimeCanvasControl(new Container());
  registerGodotObjectIdentity(node, 'SplitContainer');
  return bindGodotCanvasContainerApi(bindCanvasSplitContainer(node, {
    vertical: false, width: 0, height: 0, separation: 0,
  }));
}

export function createGodotCanvasVSplitContainer(): GodotCanvasSplitContainer {
  const node = bindRuntimeCanvasControl(new Container());
  registerGodotObjectIdentity(node, 'VSplitContainer');
  return bindGodotCanvasContainerApi(bindCanvasSplitContainer(node, {
    vertical: true, width: 0, height: 0, separation: 0,
  }));
}

export type GodotCanvasAspectRatioContainer = Container & {
  ratio: number;
  stretch_mode: number;
  alignment_horizontal: number;
  alignment_vertical: number;
  get_ratio(): number;
  set_ratio(value: number): void;
  get_stretch_mode(): number;
  set_stretch_mode(value: number): void;
  get_alignment_horizontal(): number;
  set_alignment_horizontal(value: number): void;
  get_alignment_vertical(): number;
  set_alignment_vertical(value: number): void;
};

export function createGodotCanvasAspectRatioContainer(): GodotCanvasAspectRatioContainer {
  const node = bindCanvasAspectRatioContainer(bindRuntimeCanvasControl(new Container()));
  bindGodotCanvasContainerApi(node);
  registerGodotObjectIdentity(node, 'AspectRatioContainer');
  return node;
}

export function bindCanvasAspectRatioContainer(
  node: Container,
  options: { readonly ratio?: number; readonly stretchMode?: number; readonly alignmentHorizontal?: number; readonly alignmentVertical?: number } = {},
): GodotCanvasAspectRatioContainer {
  const state = base(node, 'aspect', false);
  state.ratio = finite('AspectRatioContainer.ratio', options.ratio ?? 1);
  if (state.ratio <= 0) throw new RangeError('AspectRatioContainer.ratio must be greater than zero.');
  state.stretchMode = integer('AspectRatioContainer.stretch_mode', options.stretchMode ?? 2, 0, 3) as 0 | 1 | 2 | 3;
  state.alignment = integer('AspectRatioContainer.alignment_horizontal', options.alignmentHorizontal ?? 1, 0, 2) as 0 | 1 | 2;
  state.verticalAlignment = integer('AspectRatioContainer.alignment_vertical', options.alignmentVertical ?? 1, 0, 2) as 0 | 1 | 2;
  const apply = (): void => setCanvasContainerLayout(node, 'aspect', {
    aspectRatio: state.ratio,
    stretchMode: state.stretchMode,
    alignment: state.alignment,
    verticalAlignment: state.verticalAlignment,
  });
  const aspect = node as GodotCanvasAspectRatioContainer;
  Object.defineProperties(aspect, {
    ratio: { enumerable: true, configurable: true, get: () => state.ratio, set: (value: number) => { const next = finite('AspectRatioContainer.ratio', value); if (next <= 0) throw new RangeError('AspectRatioContainer.ratio must be greater than zero.'); state.ratio = next; apply(); } },
    stretch_mode: { enumerable: true, configurable: true, get: () => state.stretchMode, set: (value: number) => { state.stretchMode = integer('AspectRatioContainer.stretch_mode', value, 0, 3) as 0 | 1 | 2 | 3; apply(); } },
    alignment_horizontal: { enumerable: true, configurable: true, get: () => state.alignment, set: (value: number) => { state.alignment = integer('AspectRatioContainer.alignment_horizontal', value, 0, 2) as 0 | 1 | 2; apply(); } },
    alignment_vertical: { enumerable: true, configurable: true, get: () => state.verticalAlignment, set: (value: number) => { state.verticalAlignment = integer('AspectRatioContainer.alignment_vertical', value, 0, 2) as 0 | 1 | 2; apply(); } },
  });
  aspect.get_ratio = (): number => state.ratio;
  aspect.set_ratio = (value: number): void => { aspect.ratio = value; };
  aspect.get_stretch_mode = (): number => state.stretchMode;
  aspect.set_stretch_mode = (value: number): void => { aspect.stretch_mode = value; };
  aspect.get_alignment_horizontal = (): number => state.alignment;
  aspect.set_alignment_horizontal = (value: number): void => { aspect.alignment_horizontal = value; };
  aspect.get_alignment_vertical = (): number => state.verticalAlignment;
  aspect.set_alignment_vertical = (value: number): void => { aspect.alignment_vertical = value; };
  apply();
  return aspect;
}

export function resizeCanvasLayoutContainer(node: Container, width: number, height: number): void {
  // bindCanvasControl applies its authored rect before the specialized container binder is
  // installed. The binder receives that same authored size; later Control resizes enter here.
  const state = LAYOUTS.get(node);
  if (state === undefined) return;
  state.width = finite('Container width', width);
  state.height = finite('Container height', height);
  // The Control rect setter has already updated the canvas-control-state size and triggered reflow.
}

export function releaseCanvasLayoutContainer(node: Container): void {
  const state = LAYOUTS.get(node);
  if (state === undefined || state.released) return;
  state.released = true;
  clearCanvasContainerLayoutObserver(node);
  if (state.kind === 'split' && state.collapsed) {
    for (const child of node.children) child.renderable = true;
  }
  state.unregisterRelease();
  if (state.dragger !== undefined) {
    if (state.pointerDown !== undefined) state.dragger.off('pointerdown', state.pointerDown);
    state.dragger.removeFromParent();
    state.dragger.destroy();
  }
  if (state.pointerMove !== undefined) node.off('globalpointermove', state.pointerMove);
  if (state.pointerUp !== undefined) {
    node.off('pointerup', state.pointerUp);
    node.off('pointerupoutside', state.pointerUp);
  }
  LAYOUTS.delete(node);
}
