/** Retained Control state for FlowContainer, SplitContainer, and AspectRatioContainer. */

import { controlBinding, type GodotControl } from './control-state';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

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

export interface GodotFlowContainer extends GodotControl {
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
}

export function bindFlowContainer(
  control: GodotControl,
  options: {
    readonly vertical: boolean;
    readonly fixed?: boolean;
    readonly alignment?: number;
    readonly lastWrapAlignment?: number;
    readonly reverseFill?: boolean;
  },
): GodotFlowContainer {
  const flow = control as GodotFlowContainer;
  const binding = controlBinding(control);
  let vertical = boolean('FlowContainer vertical orientation', options.vertical);
  const fixed = options.fixed ?? false;
  let alignment = integer('FlowContainer.alignment', options.alignment ?? 0, 0, 2);
  let lastWrapAlignment = integer(
    'FlowContainer.last_wrap_alignment',
    options.lastWrapAlignment ?? 3,
    0,
    3,
  );
  if (lastWrapAlignment !== 3) {
    throw new Error('FlowContainer.last_wrap_alignment other than INHERIT cannot be represented by the retained browser flex layout.');
  }
  let reverseFill = boolean('FlowContainer.reverse_fill', options.reverseFill ?? false);
  const sync = (): void => binding.state.write(binding.id, {
    flowVertical: vertical,
    flowAlignment: alignment,
    flowLastWrapAlignment: lastWrapAlignment,
    flowReverseFill: reverseFill,
  });
  Object.defineProperties(flow, {
    vertical: { enumerable: true, configurable: true, get: () => vertical, set: (value: boolean) => { if (fixed) throw new Error(`Can't change orientation of fixed FlowContainer subclass.`); vertical = boolean('FlowContainer.vertical', value); sync(); } },
    alignment: { enumerable: true, configurable: true, get: () => alignment, set: (value: number) => { alignment = integer('FlowContainer.alignment', value, 0, 2); sync(); } },
    last_wrap_alignment: { enumerable: true, configurable: true, get: () => lastWrapAlignment, set: (value: number) => { const next = integer('FlowContainer.last_wrap_alignment', value, 0, 3); if (next !== 3) throw new Error('FlowContainer.last_wrap_alignment other than INHERIT cannot be represented by the retained browser flex layout.'); lastWrapAlignment = next; sync(); } },
    reverse_fill: { enumerable: true, configurable: true, get: () => reverseFill, set: (value: boolean) => { reverseFill = boolean('FlowContainer.reverse_fill', value); sync(); } },
  });
  flow.get_alignment = (): number => alignment;
  flow.set_alignment = (value: number): void => { flow.alignment = value; };
  flow.get_last_wrap_alignment = (): number => lastWrapAlignment;
  flow.set_last_wrap_alignment = (value: number): void => { flow.last_wrap_alignment = value; };
  flow.is_reverse_fill = (): boolean => reverseFill;
  flow.set_reverse_fill = (value: boolean): void => { flow.reverse_fill = value; };
  flow.is_vertical = (): boolean => vertical;
  flow.set_vertical = (value: boolean): void => { flow.vertical = value; };
  sync();
  return flow;
}

export interface GodotSplitContainer extends GodotControl {
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
}

interface SplitState {
  readonly control: GodotControl;
  readonly dragged: SignalHandle<readonly [number]>;
  vertical: boolean;
  readonly fixed: boolean;
  offset: number;
  collapsed: boolean;
  draggable: boolean;
  draggerVisibility: number;
}

function syncSplit(state: SplitState): void {
  const binding = controlBinding(state.control);
  binding.state.write(binding.id, {
    splitVertical: state.vertical,
    splitOffset: state.offset,
    splitCollapsed: state.collapsed,
    splitDraggable: state.draggable,
    splitDraggerVisibility: state.draggerVisibility,
    onSplitDrag(value): void {
      const next = finite('SplitContainer drag offset', value);
      if (!state.draggable || state.collapsed || next === state.offset) return;
      state.offset = next;
      syncSplit(state);
      state.dragged.emit(next);
    },
  });
}

export function bindSplitContainer(
  control: GodotControl,
  options: {
    readonly vertical: boolean;
    readonly fixed?: boolean;
    readonly splitOffset?: number;
    readonly collapsed?: boolean;
    readonly draggable?: boolean;
    readonly draggerVisibility?: number;
  },
): GodotSplitContainer {
  const split = control as GodotSplitContainer;
  const state: SplitState = {
    control,
    dragged: createSignal<readonly [number]>(),
    vertical: boolean('SplitContainer vertical orientation', options.vertical),
    fixed: options.fixed ?? false,
    offset: finite('SplitContainer.split_offset', options.splitOffset ?? 0),
    collapsed: boolean('SplitContainer.collapsed', options.collapsed ?? false),
    draggable: boolean('SplitContainer.draggable', options.draggable ?? true),
    draggerVisibility: integer('SplitContainer.dragger_visibility', options.draggerVisibility ?? 0, 0, 2),
  };
  Object.defineProperties(split, {
    vertical: { enumerable: true, configurable: true, get: () => state.vertical, set: (value: boolean) => { if (state.fixed) throw new Error(`Can't change orientation of fixed SplitContainer subclass.`); state.vertical = boolean('SplitContainer.vertical', value); syncSplit(state); } },
    split_offset: { enumerable: true, configurable: true, get: () => state.offset, set: (value: number) => { state.offset = finite('SplitContainer.split_offset', value); syncSplit(state); } },
    collapsed: { enumerable: true, configurable: true, get: () => state.collapsed, set: (value: boolean) => { state.collapsed = boolean('SplitContainer.collapsed', value); syncSplit(state); } },
    draggable: { enumerable: true, configurable: true, get: () => state.draggable, set: (value: boolean) => { state.draggable = boolean('SplitContainer.draggable', value); syncSplit(state); } },
    dragging_enabled: { enumerable: true, configurable: true, get: () => state.draggable, set: (value: boolean) => { state.draggable = boolean('SplitContainer.dragging_enabled', value); syncSplit(state); } },
    dragger_visibility: { enumerable: true, configurable: true, get: () => state.draggerVisibility, set: (value: number) => { state.draggerVisibility = integer('SplitContainer.dragger_visibility', value, 0, 2); syncSplit(state); } },
    dragged: { enumerable: true, configurable: true, value: state.dragged.signal },
  });
  split.get_split_offset = (index = 0): number => { firstDraggerIndex('SplitContainer.get_split_offset', index); return state.offset; };
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
    const size = state.vertical ? split.size.y : split.size.x;
    split.split_offset = Math.min(Math.max(state.offset, -size / 2), size / 2);
  };
  split.is_vertical = (): boolean => state.vertical;
  split.set_vertical = (value: boolean): void => { split.vertical = value; };
  syncSplit(state);
  return split;
}

export interface GodotAspectRatioContainer extends GodotControl {
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
}

export function bindAspectRatioContainer(
  control: GodotControl,
  options: {
    readonly ratio?: number;
    readonly stretchMode?: number;
    readonly alignmentHorizontal?: number;
    readonly alignmentVertical?: number;
  } = {},
): GodotAspectRatioContainer {
  const aspect = control as GodotAspectRatioContainer;
  const binding = controlBinding(control);
  let ratio = finite('AspectRatioContainer.ratio', options.ratio ?? 1);
  if (ratio <= 0) throw new RangeError('AspectRatioContainer.ratio must be greater than zero.');
  let stretchMode = integer('AspectRatioContainer.stretch_mode', options.stretchMode ?? 2, 0, 3);
  let horizontal = integer('AspectRatioContainer.alignment_horizontal', options.alignmentHorizontal ?? 1, 0, 2);
  let vertical = integer('AspectRatioContainer.alignment_vertical', options.alignmentVertical ?? 1, 0, 2);
  const sync = (): void => binding.state.write(binding.id, {
    aspectRatio: ratio,
    aspectStretchMode: stretchMode,
    aspectAlignmentHorizontal: horizontal,
    aspectAlignmentVertical: vertical,
  });
  Object.defineProperties(aspect, {
    ratio: { enumerable: true, configurable: true, get: () => ratio, set: (value: number) => { const next = finite('AspectRatioContainer.ratio', value); if (next <= 0) throw new RangeError('AspectRatioContainer.ratio must be greater than zero.'); ratio = next; sync(); } },
    stretch_mode: { enumerable: true, configurable: true, get: () => stretchMode, set: (value: number) => { stretchMode = integer('AspectRatioContainer.stretch_mode', value, 0, 3); sync(); } },
    alignment_horizontal: { enumerable: true, configurable: true, get: () => horizontal, set: (value: number) => { horizontal = integer('AspectRatioContainer.alignment_horizontal', value, 0, 2); sync(); } },
    alignment_vertical: { enumerable: true, configurable: true, get: () => vertical, set: (value: number) => { vertical = integer('AspectRatioContainer.alignment_vertical', value, 0, 2); sync(); } },
  });
  aspect.get_ratio = (): number => ratio;
  aspect.set_ratio = (value: number): void => { aspect.ratio = value; };
  aspect.get_stretch_mode = (): number => stretchMode;
  aspect.set_stretch_mode = (value: number): void => { aspect.stretch_mode = value; };
  aspect.get_alignment_horizontal = (): number => horizontal;
  aspect.set_alignment_horizontal = (value: number): void => { aspect.alignment_horizontal = value; };
  aspect.get_alignment_vertical = (): number => vertical;
  aspect.set_alignment_vertical = (value: number): void => { aspect.alignment_vertical = value; };
  sync();
  return aspect;
}
