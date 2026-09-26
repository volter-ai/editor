/** Control accessibility metadata projected onto retained Pixi accessibility carriers. */

import { Container } from 'pixi.js';

import { godotNodePathNew, isGodotNodePath, type GodotNodePath } from './node-path';

interface CanvasControlAccessibilityState {
  name: string;
  description: string;
  live: 0 | 1 | 2;
  labeledBy: GodotNodePath[];
  describedBy: GodotNodePath[];
  controls: GodotNodePath[];
  flowTo: GodotNodePath[];
  tooltip: string;
}

const ACCESSIBILITY = new WeakMap<Container, CanvasControlAccessibilityState>();

function stateOf(control: Container): CanvasControlAccessibilityState {
  let state = ACCESSIBILITY.get(control);
  if (state === undefined) {
    state = {
      name: '',
      description: '',
      live: 0,
      labeledBy: [],
      describedBy: [],
      controls: [],
      flowTo: [],
      tooltip: '',
    };
    ACCESSIBILITY.set(control, state);
  }
  return state;
}

function text(value: string, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`Control.${member} requires a String.`);
  return value;
}

function liveMode(value: number): 0 | 1 | 2 {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
    throw new RangeError('Control.accessibility_live requires DISABLED, POLITE, or ASSERTIVE.');
  }
  return value as 0 | 1 | 2;
}

function paths(values: readonly (string | GodotNodePath)[], member: string): GodotNodePath[] {
  if (!Array.isArray(values)) throw new TypeError(`Control.${member} requires an Array[NodePath].`);
  return values.map((value) => {
    if (typeof value === 'string') return godotNodePathNew(value);
    if (!isGodotNodePath(value)) throw new TypeError(`Control.${member} requires NodePath entries.`);
    return godotNodePathNew(value);
  });
}

function copyPaths(values: readonly GodotNodePath[]): GodotNodePath[] {
  return values.map((value) => godotNodePathNew(value));
}

function applyNative(control: Container, state: CanvasControlAccessibilityState): void {
  Reflect.set(control, 'accessible', state.name !== '' || state.description !== '' || state.tooltip !== '');
  Reflect.set(control, 'accessibleTitle', state.tooltip !== '' ? state.tooltip : state.name);
  Reflect.set(control, 'accessibleHint', state.description);
  Reflect.set(control, 'accessibleLiveRegion', state.live === 2 ? 'assertive' : state.live === 1 ? 'polite' : 'off');
}

/** Project Control.tooltip_text onto Pixi's one retained native accessibility carrier. */
export function setCanvasControlTooltipPresentation(control: Container, value: string): void {
  if (typeof value !== 'string') throw new TypeError('Control.tooltip_text requires a String.');
  const state = stateOf(control);
  state.tooltip = value;
  applyNative(control, state);
}

export interface GodotCanvasControlAccessibilityApi {
  accessibility_name: string;
  accessibility_description: string;
  accessibility_live: number;
  accessibility_labeled_by_nodes: GodotNodePath[];
  accessibility_described_by_nodes: GodotNodePath[];
  accessibility_controls_nodes: GodotNodePath[];
  accessibility_flow_to_nodes: GodotNodePath[];
  set_accessibility_name(value: string): void;
  get_accessibility_name(): string;
  set_accessibility_description(value: string): void;
  get_accessibility_description(): string;
  set_accessibility_live(value: number): void;
  get_accessibility_live(): number;
  set_accessibility_labeled_by_nodes(value: readonly (string | GodotNodePath)[]): void;
  get_accessibility_labeled_by_nodes(): GodotNodePath[];
  set_accessibility_described_by_nodes(value: readonly (string | GodotNodePath)[]): void;
  get_accessibility_described_by_nodes(): GodotNodePath[];
  set_accessibility_controls_nodes(value: readonly (string | GodotNodePath)[]): void;
  get_accessibility_controls_nodes(): GodotNodePath[];
  set_accessibility_flow_to_nodes(value: readonly (string | GodotNodePath)[]): void;
  get_accessibility_flow_to_nodes(): GodotNodePath[];
}

export function bindGodotCanvasControlAccessibilityApi<T extends Container>(
  source: T,
): T & GodotCanvasControlAccessibilityApi {
  const control = source as T & GodotCanvasControlAccessibilityApi;
  const state = stateOf(control);
  const setName = (value: string): void => { state.name = text(value, 'accessibility_name'); applyNative(control, state); };
  const setDescription = (value: string): void => { state.description = text(value, 'accessibility_description'); applyNative(control, state); };
  const setLive = (value: number): void => { state.live = liveMode(value); applyNative(control, state); };
  const setLabeledBy = (value: readonly (string | GodotNodePath)[]): void => { state.labeledBy = paths(value, 'accessibility_labeled_by_nodes'); };
  const setDescribedBy = (value: readonly (string | GodotNodePath)[]): void => { state.describedBy = paths(value, 'accessibility_described_by_nodes'); };
  const setControls = (value: readonly (string | GodotNodePath)[]): void => { state.controls = paths(value, 'accessibility_controls_nodes'); };
  const setFlowTo = (value: readonly (string | GodotNodePath)[]): void => { state.flowTo = paths(value, 'accessibility_flow_to_nodes'); };
  Object.defineProperties(control, {
    accessibility_name: { configurable: true, enumerable: true, get: () => state.name, set: setName },
    accessibility_description: { configurable: true, enumerable: true, get: () => state.description, set: setDescription },
    accessibility_live: { configurable: true, enumerable: true, get: () => state.live, set: setLive },
    accessibility_labeled_by_nodes: { configurable: true, enumerable: true, get: () => copyPaths(state.labeledBy), set: setLabeledBy },
    accessibility_described_by_nodes: { configurable: true, enumerable: true, get: () => copyPaths(state.describedBy), set: setDescribedBy },
    accessibility_controls_nodes: { configurable: true, enumerable: true, get: () => copyPaths(state.controls), set: setControls },
    accessibility_flow_to_nodes: { configurable: true, enumerable: true, get: () => copyPaths(state.flowTo), set: setFlowTo },
  });
  Object.assign(control, {
    set_accessibility_name: setName,
    get_accessibility_name: (): string => state.name,
    set_accessibility_description: setDescription,
    get_accessibility_description: (): string => state.description,
    set_accessibility_live: setLive,
    get_accessibility_live: (): number => state.live,
    set_accessibility_labeled_by_nodes: setLabeledBy,
    get_accessibility_labeled_by_nodes: (): GodotNodePath[] => copyPaths(state.labeledBy),
    set_accessibility_described_by_nodes: setDescribedBy,
    get_accessibility_described_by_nodes: (): GodotNodePath[] => copyPaths(state.describedBy),
    set_accessibility_controls_nodes: setControls,
    get_accessibility_controls_nodes: (): GodotNodePath[] => copyPaths(state.controls),
    set_accessibility_flow_to_nodes: setFlowTo,
    get_accessibility_flow_to_nodes: (): GodotNodePath[] => copyPaths(state.flowTo),
  });
  applyNative(control, state);
  return control;
}
